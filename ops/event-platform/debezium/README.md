# Debezium outbox connector contract

`event-outbox-connector.template.json` is a transport-only connector. Its
EventRouter publishes the immutable `envelope` already stored in
`public.event_outbox`; it does not validate JSON Schema, does not consult Schema
Registry, and must never be described as a schema-enforcement boundary. Kafka
brokers do not enforce the event payload contract either.

## Lossless JSON transport (2026-10-17 evidence)

Keep `table.expand.json.payload=false` and the value
`org.apache.kafka.connect.storage.StringConverter` together. PostgreSQL's JSONB
envelope arrives as existing JSON text; StringConverter emits those UTF-8 bytes
without adding another JSON string layer. All additional placements must remain
headers, not an envelope wrapper. Writer/consumer contract validation is still
mandatory; StringConverter is not a JSON/schema validator.

Actual pinned-stack A/B run
[39075079346](https://github.com/rashadoni/leaddrive-v2/actions/runs/39075079346)
on `770d576a16e1fc475b2ea0a8ca186cca803a70a5` proved the previous expansion /
JsonConverter combination changed all four snapshot payloads while metadata,
source-ID order and delivery succeeded. The unexpanded StringConverter candidate
preserved all eight SQL-origin envelopes, headers, timestamps and keys across
snapshot, streaming and a cold Connect restart. The fixture includes Unicode,
null/false/zero, nested objects and empty arrays. This is synthetic transport
evidence, not production activation or a Fund reducer/HA/TLS/DR receipt.

The integration fixture retains the old expanded converter only as an explicitly
isolated legacy diagnostic. The production-template path must pass the strict
source-parity verifier. The asset gate locks both serializer properties and
header-only placement so reverting either half cannot silently change the wire
contract again. JSON objects remain the consumer-visible format; registry
serialization/framing is not introduced.

No live connector is changed merely by merging this template. Any actual
connector rollout must retain its reviewed identity, slot and offset state and
pass the independent production activation gates. Do not create a new connector
or reset/replay offsets to apply a serializer change.

The activation invariant is therefore: the publication may contain only
contract-validated outbox rows. Application Fund writers enter the outbox only
through `appendDomainEvent`, which validates the exact eventType/dataSchema pair
and Zod payload before allocating an aggregate version. The fixed
bootstrap/rollback-compatibility SQL variants are covered by the migration gate
and executable contract fixtures. CI keeps those five runtime contracts in
one-to-one correspondence with the five registered Fund subjects.

Schema Registry still governs schema evolution and gives consumers an immutable
contract identity through `dataschema`; it does not retroactively validate a
schemaless Kafka Connect record. Pause connector activation if any writer can
bypass the reviewed application or fixed SQL contract paths.
