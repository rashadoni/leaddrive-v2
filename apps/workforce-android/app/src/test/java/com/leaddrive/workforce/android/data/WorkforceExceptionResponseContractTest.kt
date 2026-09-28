package com.leaddrive.workforce.android.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WorkforceExceptionResponseContractTest {
    @Test
    fun `exact available contract maps only known card states`() {
        assertEquals(
            WorkforceSelfExceptionResponseState.ACKNOWLEDGED,
            resolveWorkforceSelfExceptionResponseState("AVAILABLE", "ACKNOWLEDGED"),
        )
        assertEquals(
            WorkforceSelfExceptionResponseState.NOT_ACKNOWLEDGED,
            resolveWorkforceSelfExceptionResponseState("AVAILABLE", "NOT_ACKNOWLEDGED"),
        )
        assertEquals(
            WorkforceSelfExceptionResponseState.UNAVAILABLE,
            resolveWorkforceSelfExceptionResponseState("AVAILABLE", "UNAVAILABLE"),
        )
    }

    @Test
    fun `missing malformed or disabled rollout always fails closed`() {
        val rolloutValues = listOf<Any?>(
            null,
            "MIGRATION_REQUIRED",
            "available",
            " AVAILABLE ",
            true,
            1,
            mapOf("state" to "AVAILABLE"),
        )

        for (rollout in rolloutValues) {
            assertEquals(
                WorkforceSelfExceptionResponseState.UNAVAILABLE,
                resolveWorkforceSelfExceptionResponseState(rollout, "ACKNOWLEDGED"),
            )
        }
    }

    @Test
    fun `available rollout still rejects unknown or malformed card state`() {
        val cardValues = listOf<Any?>(
            null,
            "acknowledged",
            " ACKNOWLEDGED ",
            "FUTURE_STATE",
            false,
            2,
            listOf("ACKNOWLEDGED"),
        )

        for (cardState in cardValues) {
            assertEquals(
                WorkforceSelfExceptionResponseState.UNAVAILABLE,
                resolveWorkforceSelfExceptionResponseState("AVAILABLE", cardState),
            )
        }
    }

    @Test
    fun `exact acknowledgement offer accepts only bounded integral revisions`() {
        assertEquals(
            WorkforceSelfExceptionResponseAction(expectedCaseRevision = 0),
            resolveWorkforceSelfExceptionResponseAction(
                responseRecording = "AVAILABLE",
                responseState = "NOT_ACKNOWLEDGED",
                kind = "ACKNOWLEDGE",
                expectedCaseRevision = 0,
            ),
        )
        assertEquals(
            WorkforceSelfExceptionResponseAction(expectedCaseRevision = 63),
            resolveWorkforceSelfExceptionResponseAction(
                responseRecording = "AVAILABLE",
                responseState = "NOT_ACKNOWLEDGED",
                kind = "ACKNOWLEDGE",
                expectedCaseRevision = 63L,
            ),
        )
    }

    @Test
    fun `acknowledgement offer fails closed for malformed rollout state or kind`() {
        val malformedOffers = listOf(
            arrayOf(null, "NOT_ACKNOWLEDGED", "ACKNOWLEDGE", 1),
            arrayOf("MIGRATION_REQUIRED", "NOT_ACKNOWLEDGED", "ACKNOWLEDGE", 1),
            arrayOf("available", "NOT_ACKNOWLEDGED", "ACKNOWLEDGE", 1),
            arrayOf(" AVAILABLE ", "NOT_ACKNOWLEDGED", "ACKNOWLEDGE", 1),
            arrayOf(true, "NOT_ACKNOWLEDGED", "ACKNOWLEDGE", 1),
            arrayOf("AVAILABLE", null, "ACKNOWLEDGE", 1),
            arrayOf("AVAILABLE", "ACKNOWLEDGED", "ACKNOWLEDGE", 1),
            arrayOf("AVAILABLE", "not_acknowledged", "ACKNOWLEDGE", 1),
            arrayOf("AVAILABLE", " NOT_ACKNOWLEDGED ", "ACKNOWLEDGE", 1),
            arrayOf("AVAILABLE", true, "ACKNOWLEDGE", 1),
            arrayOf("AVAILABLE", "NOT_ACKNOWLEDGED", null, 1),
            arrayOf("AVAILABLE", "NOT_ACKNOWLEDGED", "acknowledge", 1),
            arrayOf("AVAILABLE", "NOT_ACKNOWLEDGED", " ACKNOWLEDGE ", 1),
            arrayOf("AVAILABLE", "NOT_ACKNOWLEDGED", "FUTURE_ACTION", 1),
            arrayOf("AVAILABLE", "NOT_ACKNOWLEDGED", false, 1),
        )

        for ((rollout, state, kind, revision) in malformedOffers) {
            assertNull(
                resolveWorkforceSelfExceptionResponseAction(
                    responseRecording = rollout,
                    responseState = state,
                    kind = kind,
                    expectedCaseRevision = revision,
                ),
            )
        }
    }

    @Test
    fun `acknowledgement offer rejects missing coerced fractional or out of range revisions`() {
        val malformedRevisions = listOf<Any?>(
            null,
            "1",
            1.5,
            -1,
            64,
            true,
            listOf(1),
        )

        for (revision in malformedRevisions) {
            assertNull(
                resolveWorkforceSelfExceptionResponseAction(
                    responseRecording = "AVAILABLE",
                    responseState = "NOT_ACKNOWLEDGED",
                    kind = "ACKNOWLEDGE",
                    expectedCaseRevision = revision,
                ),
            )
        }
    }

    @Test
    fun `acknowledgement operation stays in its encrypted response domain`() {
        val operation = WorkforceExceptionAcknowledgementOperation(
            operationId = "11111111-1111-4111-8111-111111111111",
            caseId = "case-1",
            expectedCaseRevision = 2,
            queuedAt = "2026-09-28T12:00:00Z",
        )

        assertEquals(WorkforceOutboxDomain.EXCEPTION_RESPONSE, operation.domain)
        assertEquals("11111111-1111-4111-8111-111111111111", operation.operationId)
        assertEquals("case-1", operation.caseId)
        assertEquals(2, operation.expectedCaseRevision)
        assertEquals("2026-09-28T12:00:00Z", operation.queuedAt)
    }

    @Test
    fun `downgrade safe response states remain ordinary recovery states to this version`() {
        assertEquals(
            WorkforceOutboxState.QUEUED,
            WorkforceOutboxState.fromStored("EXCEPTION_RESPONSE_QUEUED"),
        )
        assertEquals(
            WorkforceOutboxState.RETRY,
            WorkforceOutboxState.fromStored("EXCEPTION_RESPONSE_RETRY"),
        )
        assertNull(WorkforceOutboxState.fromStored("FUTURE_RESPONSE_STATE"))
    }

    @Test
    fun `response recovery aggregates every stored state without exposing row identity`() {
        val recovery = WorkforceExceptionResponseLocalRecovery.fromCounts(
            listOf(
                WorkforceOutboxRecoveryStateCount(WorkforceOutboxState.QUEUED, 101),
                WorkforceOutboxRecoveryStateCount(WorkforceOutboxState.RETRY, 2),
                WorkforceOutboxRecoveryStateCount(WorkforceOutboxState.CONFLICT, 3),
                WorkforceOutboxRecoveryStateCount(WorkforceOutboxState.EXPIRED, 4),
                WorkforceOutboxRecoveryStateCount(WorkforceOutboxState.REQUIRES_REVIEW, 5),
                WorkforceOutboxRecoveryStateCount(null, 6),
            ),
        )

        assertEquals(103L, recovery.pendingCount)
        assertEquals(3L, recovery.conflictCount)
        assertEquals(15L, recovery.reviewCount)
        assertEquals(true, recovery.hasPendingDelivery)
        assertEquals(true, recovery.hasOutstanding)

        val terminalOnly = WorkforceExceptionResponseLocalRecovery.fromCounts(
            listOf(WorkforceOutboxRecoveryStateCount(WorkforceOutboxState.CONFLICT, 1)),
        )
        assertEquals(false, terminalOnly.hasPendingDelivery)
        assertEquals(true, terminalOnly.hasOutstanding)
    }
}
