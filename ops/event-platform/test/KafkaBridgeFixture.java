/* Synthetic runner-only administration. NEVER ship/invoke as a runtime worker. */
import java.time.Duration;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.TimeUnit;
import org.apache.kafka.clients.admin.*;
import org.apache.kafka.clients.consumer.OffsetAndMetadata;
import org.apache.kafka.clients.producer.*;
import org.apache.kafka.common.TopicPartition;
import org.apache.kafka.common.serialization.ByteArraySerializer;

public final class KafkaBridgeFixture {
    private static void require(boolean value) { if (!value) throw new IllegalStateException("FIXTURE_GUARD"); }
    public static void main(String[] args) throws Exception {
        require("true".equals(System.getenv("GITHUB_ACTIONS")) && "1".equals(System.getenv("LD_EVENT_STACK_DISPOSABLE")));
        require(args.length >= 3 && args[1].matches("ld\\.testbroker\\.[a-z0-9-]+\\.events\\.v1") && args[2].matches("ld-testbroker-[a-z0-9-]+"));
        String topic = args[1], group = args[2];
        Properties p = new Properties();
        p.put("bootstrap.servers", "kafka:9092"); p.put("request.timeout.ms", "5000"); p.put("default.api.timeout.ms", "10000");
        try (Admin admin = Admin.create(p)) {
            var tp = new TopicPartition(topic, 0);
            if (args[0].equals("create")) {
                require(args.length == 4 && Set.of("plain", "missing", "compact", "transactions", "empty").contains(args[3]));
                admin.createTopics(List.of(new NewTopic(topic, 1, (short) 1).configs(Map.of("cleanup.policy", args[3].equals("compact") ? "compact" : "delete")))).all().get(10, TimeUnit.SECONDS);
                if (!args[3].equals("missing")) admin.alterConsumerGroupOffsets(group, Map.of(tp, new OffsetAndMetadata(0))).all().get(10, TimeUnit.SECONDS);
                p.put("acks", "all"); p.put("enable.idempotence", "true");
                if (args[3].equals("transactions")) p.put("transactional.id", group + "-producer");
                try (var producer = new KafkaProducer<byte[], byte[]>(p, new ByteArraySerializer(), new ByteArraySerializer())) {
                    boolean tx = args[3].equals("transactions");
                    if (tx) producer.initTransactions();
                    for (int index = 0; index < (args[3].equals("empty") ? 0 : 3); index++) {
                        if (tx) producer.beginTransaction();
                        var record = new ProducerRecord<byte[], byte[]>(topic, 0, (index == 1 ? "tenant-b" : "tenant-a").getBytes(), ("event-" + index).getBytes());
                        record.headers().add("fixture", "one".getBytes()).add("fixture", "two".getBytes());
                        producer.send(record).get(10, TimeUnit.SECONDS);
                        if (tx) { if (index == 1) producer.abortTransaction(); else producer.commitTransaction(); }
                    }
                }
                var description = admin.describeTopics(List.of(topic)).allTopicNames().get(10, TimeUnit.SECONDS).get(topic);
                System.out.println(admin.describeCluster().clusterId().get(10, TimeUnit.SECONDS) + "\t" + description.topicId());
            } else if (args[0].equals("seed")) {
                // A NEW synthetic group's first cursor only; never reset one.
                require(args.length == 4 && args[3].matches("0|[1-9][0-9]{0,18}"));
                long offset = Long.parseLong(args[3]);
                require(admin.listConsumerGroupOffsets(group).partitionsToOffsetAndMetadata().get(10, TimeUnit.SECONDS).isEmpty());
                long begin = admin.listOffsets(Map.of(tp, OffsetSpec.earliest())).all().get(10, TimeUnit.SECONDS).get(tp).offset();
                long end = admin.listOffsets(Map.of(tp, OffsetSpec.latest())).all().get(10, TimeUnit.SECONDS).get(tp).offset();
                require(offset >= begin && offset <= end);
                admin.alterConsumerGroupOffsets(group, Map.of(tp, new OffsetAndMetadata(offset))).all().get(10, TimeUnit.SECONDS);
                System.out.println("SEEDED");
            } else if (args[0].equals("produce")) {
                require(args.length == 3);
                byte[] input = System.in.readNBytes(8 * 1024 * 1024 + 1);
                require(input.length > 0 && input.length <= 8 * 1024 * 1024);
                for (byte value : input) require(value == 9 || value == 10 || (value >= 32 && value <= 126));
                String[] lines = new String(input, StandardCharsets.US_ASCII).split("\n", -1);
                require(lines.length >= 2 && lines.length <= 129 && lines[lines.length - 1].isEmpty());
                p.put("acks", "all"); p.put("enable.idempotence", "true"); p.put("max.block.ms", "10000");
                try (var producer = new KafkaProducer<byte[], byte[]>(p, new ByteArraySerializer(), new ByteArraySerializer())) {
                    for (int i = 0; i < lines.length - 1; i++) {
                        require(lines[i].length() <= 1_500_000);
                        String[] fields = lines[i].split("\t", -1); require(fields.length == 6);
                        byte[][] values = new byte[6][]; int total = 0;
                        for (int j = 0; j < fields.length; j++) {
                            values[j] = Base64.getDecoder().decode(fields[j]);
                            require(values[j].length > 0 && Base64.getEncoder().encodeToString(values[j]).equals(fields[j]));
                            total += values[j].length;
                        }
                        require(total + 38 <= 1_048_576);
                        var record = new ProducerRecord<byte[], byte[]>(topic, 0, values[0], values[1]);
                        String[] headers = {"id", "eventtype", "organizationid", "payloadhash"};
                        for (int j = 0; j < headers.length; j++) record.headers().add(headers[j], values[j + 2]);
                        System.out.println(producer.send(record).get(10, TimeUnit.SECONDS).offset());
                    }
                }
            } else if (args[0].equals("offset")) {
                var value = admin.listConsumerGroupOffsets(group).partitionsToOffsetAndMetadata().get(10, TimeUnit.SECONDS).get(tp);
                System.out.println(value == null ? "NONE" : value.offset());
            } else if (args[0].equals("expire")) {
                // Delete only this exact disposable topic's synthetic prefix.
                admin.deleteRecords(Map.of(tp, RecordsToDelete.beforeOffset(2))).all().get(10, TimeUnit.SECONDS);
                System.out.println("EXPIRED");
            } else if (args[0].equals("recreate")) {
                admin.deleteTopics(List.of(topic)).all().get(10, TimeUnit.SECONDS);
                admin.createTopics(List.of(new NewTopic(topic, 1, (short) 1).configs(Map.of("cleanup.policy", "delete")))).all().get(10, TimeUnit.SECONDS);
                System.out.println("RECREATED");
            } else require(false);
        }
    }
}
