plugins {
    // Pinned, never a dynamic version: AGP 9.3 supports API 37 and JDK 17.
    id("com.android.application") version "9.3.0" apply false
    // Required by the Kotlin 2.x Compose compiler. Android Kotlin sources use
    // AGP's built-in Kotlin support; do not add the obsolete kotlin-android plugin.
    id("org.jetbrains.kotlin.plugin.compose") version "2.3.21" apply false
}
