# Debezium outbox connector contract

`event-outbox-connector.template.json` is a transport-only connector. Its
EventRouter publishes the immutable `envelope` already stored in
`public.event_outbox`; it does not validate JSON Schema, does not consult Schema
Registry, and must never be described as a schema-enforcement boundary. Kafka
brokers do not enforce the event payload contract either.

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
