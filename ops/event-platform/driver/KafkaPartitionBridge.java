/* Apache Kafka 4.3.1 public API bridge. No production startup hook. */
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermission;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import org.apache.kafka.clients.admin.*;
import org.apache.kafka.clients.consumer.*;
import org.apache.kafka.common.*;
import org.apache.kafka.common.config.ConfigResource;
import org.apache.kafka.common.serialization.Deserializer;

/**
 * One foreground consumer thread: NEXT -> one visible record -> ACK -> NEXT.
 * NO poll/rejoin while SQL/IPC acknowledgement is outstanding. Classic EAGER
 * assignment only. commitSync may retry transport in the SAME generation,
 * never join a new one; failure/timeout terminates this process.
 * Wire stdout is private IPC, NOT a log (contains event payloads in base64).
 */
public final class KafkaPartitionBridge {
    private static final Duration API = Duration.ofSeconds(10);
    private static final int MAX_RECORD_BYTES = 1024 * 1024;
    private static final Base64.Encoder B64 = Base64.getEncoder();
    private final KafkaConsumer<byte[], byte[]> consumer;
    private final Admin admin;
    private final String cluster, group, topic, topicId;
    private final int partitions;
    private final Map<TopicPartition, Lease> leases = new HashMap<>();
    private long sequence;
    private record Lease(String id, ConsumerGroupMetadata membership, long cursor) {}
    private static void require(boolean ok) { if (!ok) throw new IllegalStateException("BRIDGE_GUARD"); }
    private static String identity(String text) {
        require(text != null && text.matches("[A-Za-z0-9_.:-]{1,249}")); return text;
    }
    private static void emit(String... fields) {
        System.out.println(String.join("\t", fields));
        if (System.out.checkError()) throw new IllegalStateException("BRIDGE_PIPE");
    }
    private static String bytes(byte[] value) { return value == null ? "~" : B64.encodeToString(value); }
    private static final class CheckedBytes implements Deserializer<byte[]>, ClusterResourceListener {
        private final String cluster;
        CheckedBytes(String cluster) { this.cluster = cluster; }
        public byte[] deserialize(String topic, byte[] data) { return data; }
        public void onUpdate(ClusterResource resource) { require(cluster.equals(resource.clusterId())); }
    }

    private KafkaPartitionBridge(Properties input) throws Exception {
        cluster = identity(input.getProperty("expected.cluster.id"));
        group = identity(input.getProperty("group.id"));
        topic = identity(input.getProperty("topic"));
        topicId = identity(input.getProperty("expected.topic.id"));
        require(topic.matches("ld\\.[a-z][a-z0-9]*\\.[a-z][a-z0-9-]*\\.events\\.v1"));
        partitions = Integer.parseInt(input.getProperty("expected.partitions"));
        require(partitions > 0 && partitions <= 128);
        Set<String> keys = Set.of("expected.cluster.id", "group.id", "topic", "expected.topic.id",
            "expected.partitions", "bootstrap.servers", "security.protocol", "ssl.truststore.location",
            "ssl.truststore.password", "ssl.truststore.type", "ssl.keystore.location", "ssl.keystore.password",
            "ssl.keystore.type", "ssl.key.password", "sasl.mechanism", "sasl.jaas.config", "test.profile");
        require(keys.containsAll(input.stringPropertyNames()));
        Properties props = new Properties();
        for (String key : input.stringPropertyNames()) {
            if (key.startsWith("ssl.") || key.startsWith("sasl.") || key.equals("bootstrap.servers") || key.equals("security.protocol"))
                props.setProperty(key, input.getProperty(key));
        }
        String protocol = props.getProperty("security.protocol", "");
        if (input.containsKey("test.profile")) {
            require(input.getProperty("test.profile").equals("disposable-ci"));
            require("true".equals(System.getenv("GITHUB_ACTIONS")) && "1".equals(System.getenv("LD_EVENT_STACK_DISPOSABLE")));
            require("kafka:9092".equals(props.getProperty("bootstrap.servers")) && protocol.equals("PLAINTEXT"));
            require(topic.startsWith("ld.testbroker.") && (group.startsWith("ld-testbroker-")
                || group.matches("ld\\.testbroker\\.finance\\.fund-shadow\\.v(?:[2-9]|[1-9][0-9]{1,9})\\.[a-z][a-z0-9-]{0,62}")));
        } else require(protocol.equals("SSL") || protocol.equals("SASL_SSL"));
        require(props.getProperty("bootstrap.servers", "").length() > 0);
        props.setProperty("ssl.endpoint.identification.algorithm", "https");
        props.setProperty("request.timeout.ms", "5000");
        props.setProperty("default.api.timeout.ms", "10000");
        props.setProperty("client.id", "leaddrive-partition-bridge-" + UUID.randomUUID());
        admin = Admin.create(props);
        verifyTopic();
        props.setProperty("group.id", group);
        props.setProperty("group.protocol", "classic");
        props.setProperty("partition.assignment.strategy", RangeAssignor.class.getName());
        props.setProperty("enable.auto.commit", "false");
        props.setProperty("auto.offset.reset", "none");
        props.setProperty("allow.auto.create.topics", "false");
        props.setProperty("isolation.level", "read_committed");
        props.setProperty("max.poll.records", "1");
        props.setProperty("max.poll.interval.ms", "30000");
        props.setProperty("session.timeout.ms", "10000");
        props.setProperty("heartbeat.interval.ms", "2000");
        props.setProperty("max.partition.fetch.bytes", Integer.toString(MAX_RECORD_BYTES));
        props.setProperty("fetch.max.bytes", Integer.toString(MAX_RECORD_BYTES));
        props.setProperty("check.crcs", "true");
        props.setProperty("interceptor.classes", "");
        consumer = new KafkaConsumer<>(props, new CheckedBytes(cluster), new CheckedBytes(cluster));
        consumer.subscribe(List.of(topic), new ConsumerRebalanceListener() {
            public void onPartitionsRevoked(Collection<TopicPartition> revoked) { revoke(revoked); }
            public void onPartitionsLost(Collection<TopicPartition> lost) { revoke(lost); }
            public void onPartitionsAssigned(Collection<TopicPartition> assigned) {
                require(leases.isEmpty()); // RangeAssignor is EAGER; no retained leases.
                var membership = consumer.groupMetadata();
                require(membership.generationId() >= 0 && group.equals(membership.groupId()) && membership.groupInstanceId().isEmpty());
                identity(membership.memberId());
                var committed = consumer.committed(new HashSet<>(assigned), API);
                var begin = consumer.beginningOffsets(assigned, API);
                var end = consumer.endOffsets(assigned, API);
                for (var partition : assigned) {
                    require(partition.topic().equals(topic) && partition.partition() >= 0 && partition.partition() < partitions);
                    var position = committed.get(partition);
                    require(position != null && position.offset() >= begin.get(partition) && position.offset() <= end.get(partition));
                    long cursor = position.offset();
                    // Never initialize/reset a missing group, including an empty topic.
                    require(consumer.position(partition, API) == cursor);
                    var lease = new Lease(Long.toString(++sequence), membership, cursor);
                    leases.put(partition, lease);
                    emit("ASSIGN", lease.id(), membership.memberId(), Integer.toString(membership.generationId()),
                        Integer.toString(partition.partition()), Long.toString(cursor));
                }
            }
        });
        emit("READY", cluster, group, topic);
    }
    private void revoke(Collection<TopicPartition> partitions) {
        for (var partition : partitions) {
            var lease = leases.remove(partition);
            if (lease != null) emit("REVOKE", lease.id());
        }
    }
    private void verifyTopic() throws Exception {
        require(cluster.equals(admin.describeCluster().clusterId().get(10, TimeUnit.SECONDS)));
        var description = admin.describeTopics(List.of(topic)).allTopicNames().get(10, TimeUnit.SECONDS).get(topic);
        require(description != null && topicId.equals(description.topicId().toString()) && description.partitions().size() == partitions);
        var resource = new ConfigResource(ConfigResource.Type.TOPIC, topic);
        var config = admin.describeConfigs(List.of(resource)).all().get(10, TimeUnit.SECONDS).get(resource);
        require(config != null && "delete".equals(config.get("cleanup.policy").value()));
    }
    private void checkRange() {
        var begin = consumer.beginningOffsets(leases.keySet(), API);
        var end = consumer.endOffsets(leases.keySet(), API);
        for (var entry : leases.entrySet())
            require(entry.getValue().cursor() >= begin.get(entry.getKey()) && entry.getValue().cursor() <= end.get(entry.getKey()));
    }
    private static String readCommand(InputStream in) throws IOException {
        var out = new ByteArrayOutputStream();
        for (int ch; (ch = in.read()) != -1;) {
            if (ch == '\n') return out.toString(StandardCharsets.US_ASCII);
            require(ch == '\t' || (ch >= 32 && ch <= 126));
            require(out.size() < 512); out.write(ch);
        }
        require(out.size() == 0); return "STOP";
    }
    private void run() throws Exception {
        var reader = Executors.newSingleThreadExecutor(r -> { var t = new Thread(r, "bounded-command-reader"); t.setDaemon(true); return t; });
        var in = new BufferedInputStream(System.in);
        ConsumerRecord<byte[], byte[]> pending = null;
        Lease frozen = null;
        try {
            for (;;) {
                String command = reader.submit(() -> readCommand(in)).get(60, TimeUnit.SECONDS);
                if (command.equals("STOP")) return;
                if (command.equals("NEXT")) {
                    require(pending == null);
                    verifyTopic(); checkRange();
                    var records = consumer.poll(Duration.ofSeconds(1));
                    require(records.count() <= 1);
                    verifyTopic(); // Admission must still name the same topic incarnation after poll.
                    checkRange(); // Fail before exposing a record whose preceding history expired.
                    if (records.isEmpty()) { emit("IDLE"); continue; }
                    pending = records.iterator().next();
                    var tp = new TopicPartition(pending.topic(), pending.partition());
                    frozen = leases.get(tp);
                    require(frozen != null && frozen.membership().equals(consumer.groupMetadata()));
                    require(pending.offset() >= frozen.cursor() && pending.offset() < Long.MAX_VALUE);
                    int size = (pending.key() == null ? 0 : pending.key().length) + (pending.value() == null ? 0 : pending.value().length);
                    var headers = new ArrayList<String>();
                    for (var header : pending.headers()) {
                        byte[] name = header.key().getBytes(StandardCharsets.UTF_8);
                        require(name.length > 0 && name.length <= 128 && headers.size() < 64);
                        size = Math.addExact(size, name.length + (header.value() == null ? 0 : header.value().length));
                        headers.add(bytes(name)); headers.add(bytes(header.value()));
                    }
                    require(size <= MAX_RECORD_BYTES);
                    var fields = new ArrayList<>(List.of("RECORD", frozen.id(), Long.toString(pending.offset()),
                        bytes(pending.key()), bytes(pending.value()), Integer.toString(headers.size() / 2)));
                    fields.addAll(headers); emit(fields.toArray(String[]::new));
                } else {
                    String[] fields = command.split("\t", -1);
                    require(pending != null && frozen != null && fields.length == 3 && fields[0].equals("ACK"));
                    String next = Long.toString(Math.addExact(pending.offset(), 1));
                    require(fields[1].equals(frozen.id()) && fields[2].equals(next));
                    // SQL may have taken time. Revalidate before name-based
                    // OffsetCommit too; runtime ACLs must forbid topic deletion.
                    verifyTopic(); checkRange();
                    require(frozen.membership().equals(consumer.groupMetadata()));
                    var tp = new TopicPartition(pending.topic(), pending.partition());
                    require(leases.get(tp) == frozen && consumer.assignment().contains(tp));
                    // NO poll/rejoin before/inside this public synchronous call.
                    // A stale metadata snapshot alone does not prove membership:
                    // the broker validates the ORIGINAL generation/member too.
                    consumer.commitSync(Map.of(tp, new OffsetAndMetadata(Long.parseLong(next), pending.leaderEpoch(), "")), API);
                    require(frozen.membership().equals(consumer.groupMetadata()) && leases.get(tp) == frozen);
                    leases.put(tp, new Lease(frozen.id(), frozen.membership(), Long.parseLong(next)));
                    emit("COMMITTED", frozen.id(), next);
                    pending = null; frozen = null;
                }
            }
        } finally { reader.shutdownNow(); }
    }
    private static Properties load(Path path) throws Exception {
        require(Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS) && !Files.isSymbolicLink(path) && Files.size(path) <= 16384);
        var permissions = Files.getPosixFilePermissions(path, LinkOption.NOFOLLOW_LINKS);
        require(permissions.equals(Set.of(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE)));
        var props = new Properties();
        try (var in = Files.newInputStream(path)) { props.load(in); }
        return props;
    }
    public static void main(String[] args) {
        KafkaPartitionBridge bridge = null;
        int code = 0;
        try {
            require(args.length == 1);
            bridge = new KafkaPartitionBridge(load(Path.of(args[0])));
            bridge.run();
        } catch (Throwable failure) {
            // Never print properties, exception text, stack traces or event data.
            emit("FAIL", "BRIDGE_STOPPED"); code = 1;
        } finally {
            if (bridge != null) {
                try { bridge.consumer.close(Duration.ofMillis(500)); } catch (Throwable ignored) { code = 1; }
                try { bridge.admin.close(Duration.ofMillis(500)); } catch (Throwable ignored) { code = 1; }
            }
        }
        System.exit(code);
    }
}
