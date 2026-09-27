package com.leaddrive.workforce.android.data

import org.junit.Assert.assertEquals
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
}
