package com.leaddrive.workforce.android.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.io.IOException
import java.security.KeyStore
import java.time.Instant
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * Encrypted, tenant-isolated durable outbox for the standalone Workforce app.
 * Room holds only queue metadata and AES-GCM ciphertext. The actual tenant
 * slug, action and server payload remain inside a distinct Android Keystore
 * encrypted envelope. This avoids relying on deprecated encrypted-preference
 * wrappers while preserving deterministic operation replay.
 */
class WorkforceEncryptedOutbox(context: Context) {
    private val applicationContext = context.applicationContext
    private val database = Room.databaseBuilder(
        applicationContext,
        WorkforceOutboxDatabase::class.java,
        DATABASE_NAME,
    ).build()
    private val cipher = WorkforceOutboxCipher()

    suspend fun enqueue(session: WorkforceStoredSession, operation: WorkforceSyncOperation) = withContext(Dispatchers.IO) {
        require(!operation.hasEphemeralProof) { "Ephemeral attendance proof cannot enter the durable outbox." }
        ACCOUNT_BOUNDARY_MUTEX.withLock {
            val now = System.currentTimeMillis()
            val plaintext = operation.toEncryptedPayload(session.organizationSlug)
            val encrypted = cipher.encrypt(
                operationId = operation.operationId,
                domain = operation.domain,
                plaintext = plaintext,
            )
            database.operations().insertIgnore(
                WorkforceOutboxEntity(
                    operationId = operation.operationId,
                    domain = operation.domain.name,
                    createdAtEpochMs = now,
                    expiresAtEpochMs = operation.queuedAt.toEpochMillisOr(now) + OFFLINE_HORIZON_MS,
                    nextAttemptAtEpochMs = now,
                    attemptCount = 0,
                    state = WorkforceOutboxState.QUEUED.name,
                    ciphertext = encrypted.ciphertext,
                    initializationVector = encrypted.initializationVector,
                    detailCode = null,
                ),
            )
            WorkforceOutboxScheduler.schedule(applicationContext)
        }
    }

    /**
     * Logout and tenant switch are hard isolation boundaries. Persisted claims
     * must not be replayed after another employee or tenant signs in.
     */
    suspend fun clearForAccountBoundary() = withContext(Dispatchers.IO) {
        ACCOUNT_BOUNDARY_MUTEX.withLock {
            cipher.deleteKey()
            database.operations().deleteAll()
        }
    }

    suspend fun drain(
        session: WorkforceStoredSession,
        deviceId: String,
        api: WorkforceApiClient,
    ): WorkforceOutboxDrainResult = withContext(Dispatchers.IO) {
        ACCOUNT_BOUNDARY_MUTEX.withLock {
            var retryNeeded = false
            val now = System.currentTimeMillis()
            for (domainValue in database.operations().pendingDomains()) {
                val domain = WorkforceOutboxDomain.fromStored(domainValue) ?: continue
                // Read the absolute oldest pending item, even while its retry
                // delay is active. Filtering by due time in SQL would let a
                // later action overtake that head-of-line operation.
                while (true) {
                    val row = database.operations().oldestPending(domain.name) ?: break
                    if (row.nextAttemptAtEpochMs > now) {
                        retryNeeded = true
                        break
                    }
                    if (row.expiresAtEpochMs <= now) {
                        database.operations().markTerminal(
                            row.operationId,
                            WorkforceOutboxState.EXPIRED.name,
                            "OFFLINE_HORIZON_EXPIRED",
                        )
                        continue
                    }
                    val stored = cipher.decrypt(row.operationId, domain, row.ciphertext, row.initializationVector)
                        ?.let(WorkforceWorkdayOperation::fromEncryptedPayload)
                    if (stored == null) {
                        database.operations().markTerminal(
                            row.operationId,
                            WorkforceOutboxState.REQUIRES_REVIEW.name,
                            "OUTBOX_DECRYPTION_FAILED",
                        )
                        continue
                    }
                    if (stored.operation.domain != domain) {
                        database.operations().markTerminal(
                            row.operationId,
                            WorkforceOutboxState.REQUIRES_REVIEW.name,
                            "OUTBOX_DOMAIN_MISMATCH",
                        )
                        continue
                    }
                    if (stored.organizationSlug != session.organizationSlug.trim().lowercase()) {
                        // This should only be reachable after unexpected local state
                        // damage; never replay a former tenant's operation.
                        database.operations().delete(row.operationId)
                        continue
                    }
                    try {
                        api.submitOperation(session, deviceId, stored.operation)
                        database.operations().delete(row.operationId)
                    } catch (error: WorkforceActionConflictException) {
                        database.operations().markTerminal(
                            row.operationId,
                            WorkforceOutboxState.CONFLICT.name,
                            error.recoveryCode ?: "SYNC_STATE_CHANGED",
                        )
                    } catch (error: WorkforceApiException) {
                        if (error.recoverable && row.attemptCount + 1 < MAX_ATTEMPTS) {
                            database.operations().retry(
                                operationId = row.operationId,
                                attemptCount = row.attemptCount + 1,
                                nextAttemptAtEpochMs = retryAt(row.attemptCount + 1, now),
                                detailCode = error.recoveryCode ?: "TRANSIENT_SERVER_FAILURE",
                            )
                            retryNeeded = true
                        } else {
                            database.operations().markTerminal(
                                row.operationId,
                                WorkforceOutboxState.REQUIRES_REVIEW.name,
                                error.recoveryCode ?: "SYNC_OPERATION_REJECTED",
                            )
                        }
                        // Do not let a later action overtake this domain's failed
                        // head-of-line operation.
                        break
                    } catch (_: IOException) {
                        if (row.attemptCount + 1 < MAX_ATTEMPTS) {
                            database.operations().retry(
                                operationId = row.operationId,
                                attemptCount = row.attemptCount + 1,
                                nextAttemptAtEpochMs = retryAt(row.attemptCount + 1, now),
                                detailCode = "NETWORK_UNAVAILABLE",
                            )
                            retryNeeded = true
                        } else {
                            database.operations().markTerminal(
                                row.operationId,
                                WorkforceOutboxState.REQUIRES_REVIEW.name,
                                "RETRY_LIMIT_REACHED",
                            )
                        }
                        break
                    } catch (error: CancellationException) {
                        throw error
                    } catch (_: Throwable) {
                        // Unknown local failures are review-only. Retrying a payload
                        // we cannot classify would risk duplicate or silent facts.
                        database.operations().markTerminal(
                            row.operationId,
                            WorkforceOutboxState.REQUIRES_REVIEW.name,
                            "OUTBOX_LOCAL_FAILURE",
                        )
                        break
                    }
                }
            }
            WorkforceOutboxDrainResult(retryNeeded)
        }
    }

    private fun retryAt(attempt: Int, now: Long): Long {
        val delay = (INITIAL_RETRY_MS * (1L shl (attempt - 1).coerceAtMost(8))).coerceAtMost(MAX_RETRY_MS)
        return now + delay
    }

    private companion object {
        val ACCOUNT_BOUNDARY_MUTEX = Mutex()
        const val DATABASE_NAME = "workforce-outbox.v1.db"
        const val OFFLINE_HORIZON_MS = 7 * 24 * 60 * 60 * 1_000L
        const val MAX_ATTEMPTS = 8
        const val INITIAL_RETRY_MS = 30_000L
        const val MAX_RETRY_MS = 6 * 60 * 60 * 1_000L
    }
}

data class WorkforceOutboxDrainResult(val retryNeeded: Boolean)

enum class WorkforceOutboxDomain {
    WORKDAY,
    HRM_REQUEST;

    companion object {
        fun fromStored(value: String): WorkforceOutboxDomain? = entries.firstOrNull { it.name == value }
    }
}

enum class WorkforceOutboxState {
    QUEUED,
    RETRY,
    CONFLICT,
    EXPIRED,
    REQUIRES_REVIEW,
}

@Entity(tableName = "workforce_outbox_operations")
data class WorkforceOutboxEntity(
    @PrimaryKey val operationId: String,
    val domain: String,
    val createdAtEpochMs: Long,
    val expiresAtEpochMs: Long,
    val nextAttemptAtEpochMs: Long,
    val attemptCount: Int,
    val state: String,
    val ciphertext: String,
    val initializationVector: String,
    val detailCode: String?,
)

@Dao
interface WorkforceOutboxDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertIgnore(entity: WorkforceOutboxEntity): Long

    @Query("SELECT DISTINCT domain FROM workforce_outbox_operations WHERE state IN ('QUEUED', 'RETRY') ORDER BY domain ASC")
    suspend fun pendingDomains(): List<String>

    @Query("SELECT * FROM workforce_outbox_operations WHERE domain = :domain AND state IN ('QUEUED', 'RETRY') ORDER BY createdAtEpochMs ASC LIMIT 1")
    suspend fun oldestPending(domain: String): WorkforceOutboxEntity?

    @Query("UPDATE workforce_outbox_operations SET attemptCount = :attemptCount, nextAttemptAtEpochMs = :nextAttemptAtEpochMs, state = 'RETRY', detailCode = :detailCode WHERE operationId = :operationId")
    suspend fun retry(operationId: String, attemptCount: Int, nextAttemptAtEpochMs: Long, detailCode: String)

    @Query("UPDATE workforce_outbox_operations SET state = :state, detailCode = :detailCode WHERE operationId = :operationId")
    suspend fun markTerminal(operationId: String, state: String, detailCode: String)

    @Query("DELETE FROM workforce_outbox_operations WHERE operationId = :operationId")
    suspend fun delete(operationId: String)

    @Query("DELETE FROM workforce_outbox_operations")
    suspend fun deleteAll()
}

@Database(entities = [WorkforceOutboxEntity::class], version = 1, exportSchema = true)
abstract class WorkforceOutboxDatabase : RoomDatabase() {
    abstract fun operations(): WorkforceOutboxDao
}

private data class WorkforceEncryptedBlob(
    val ciphertext: String,
    val initializationVector: String,
)

private class WorkforceOutboxCipher {
    private val keyStore = KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }

    fun encrypt(operationId: String, domain: WorkforceOutboxDomain, plaintext: String): WorkforceEncryptedBlob {
        val cipher = Cipher.getInstance(CIPHER_TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, encryptionKey())
        cipher.updateAAD(aad(operationId, domain))
        return WorkforceEncryptedBlob(
            ciphertext = Base64.encodeToString(cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP),
            initializationVector = Base64.encodeToString(cipher.iv, Base64.NO_WRAP),
        )
    }

    fun decrypt(
        operationId: String,
        domain: WorkforceOutboxDomain,
        ciphertext: String,
        initializationVector: String,
    ): String? = runCatching {
        val cipher = Cipher.getInstance(CIPHER_TRANSFORMATION)
        cipher.init(
            Cipher.DECRYPT_MODE,
            encryptionKey(),
            GCMParameterSpec(GCM_TAG_LENGTH_BITS, Base64.decode(initializationVector, Base64.NO_WRAP)),
        )
        cipher.updateAAD(aad(operationId, domain))
        String(cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP)), Charsets.UTF_8)
    }.getOrNull()

    fun deleteKey() {
        if (keyStore.containsAlias(KEY_ALIAS)) keyStore.deleteEntry(KEY_ALIAS)
    }

    private fun encryptionKey(): SecretKey {
        val existing = keyStore.getKey(KEY_ALIAS, null) as? SecretKey
        if (existing != null) return existing
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEY_STORE)
        generator.init(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build(),
        )
        return generator.generateKey()
    }

    private fun aad(operationId: String, domain: WorkforceOutboxDomain): ByteArray =
        "leaddrive.workforce.outbox.v1:$operationId:${domain.name}".toByteArray(Charsets.UTF_8)

    private companion object {
        const val ANDROID_KEY_STORE = "AndroidKeyStore"
        const val KEY_ALIAS = "leaddrive.workforce.outbox.v1"
        const val CIPHER_TRANSFORMATION = "AES/GCM/NoPadding"
        const val GCM_TAG_LENGTH_BITS = 128
    }
}

private object WorkforceOutboxScheduler {
    private const val UNIQUE_WORK_NAME = "leaddrive.workforce.outbox.v1"

    fun schedule(context: Context) {
        val request = OneTimeWorkRequestBuilder<WorkforceOutboxDrainWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .addTag(UNIQUE_WORK_NAME)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(UNIQUE_WORK_NAME, ExistingWorkPolicy.KEEP, request)
    }
}

class WorkforceOutboxDrainWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val secureStore = WorkforceSecureStore(applicationContext)
        val session = secureStore.readSession() ?: return Result.success()
        val outbox = WorkforceEncryptedOutbox(applicationContext)
        val result = outbox.drain(
            session = session,
            deviceId = secureStore.installationId(),
            api = WorkforceApiClient(WorkforceRuntimeConfiguration.fromBuildConfig()),
        )
        return if (result.retryNeeded) Result.retry() else Result.success()
    }
}

private fun String.toEpochMillisOr(fallback: Long): Long = runCatching { Instant.parse(this).toEpochMilli() }.getOrDefault(fallback)
