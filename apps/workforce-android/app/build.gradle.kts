plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.devtools.ksp")
}

val releaseApplicationId = providers.gradleProperty("WORKFORCE_APPLICATION_ID")
val releaseApiBaseUrl = providers.gradleProperty("WORKFORCE_API_BASE_URL")
val releaseVersionName = providers.gradleProperty("WORKFORCE_VERSION_NAME")
val releaseVersionCode = providers.gradleProperty("WORKFORCE_VERSION_CODE")
val releaseBuildSha = providers.gradleProperty("WORKFORCE_BUILD_SHA")

fun quotedBuildValue(value: String): String = "\"${value.replace("\\", "\\\\").replace("\"", "\\\"")}\""

fun requireReleaseValue(name: String, value: String?) {
    check(!value.isNullOrBlank()) {
        "$name is required for a release bundle and must be supplied by CI/release management, never committed."
    }
}

android {
    namespace = "com.leaddrive.workforce.android"
    compileSdk = 37

    defaultConfig {
        // This development-only ID is intentionally not the future Play ID.
        // A release task validates a separately supplied identity before
        // packaging, so the app cannot accidentally claim a production name.
        applicationId = "com.leaddrive.workforce.debug"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.0.0-debug"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "WORKFORCE_API_BASE_URL", quotedBuildValue("https://invalid.invalid/"))
        buildConfigField("String", "WORKFORCE_CLIENT_FAMILY", quotedBuildValue("workforce"))
        buildConfigField("String", "WORKFORCE_CLIENT_PLATFORM", quotedBuildValue("android"))
        // Debug source has no immutable release artifact. It must report
        // unknown rather than inventing a source revision for diagnostics.
        buildConfigField("String", "WORKFORCE_BUILD_SHA", quotedBuildValue("unknown"))
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".dev"
        }
        release {
            // A deliberately invalid placeholder means even a local release
            // configuration cannot be shipped before release management gives
            // the final verified Play application ID.
            applicationId = releaseApplicationId.orElse("invalid.release.workforce").get()
            versionName = releaseVersionName.orElse("0.0.0-invalid").get()
            versionCode = releaseVersionCode.map(String::toInt).orElse(0).get()
            buildConfigField(
                "String",
                "WORKFORCE_API_BASE_URL",
                quotedBuildValue(releaseApiBaseUrl.orElse("https://invalid.invalid/").get()),
            )
            buildConfigField(
                "String",
                "WORKFORCE_BUILD_SHA",
                quotedBuildValue(releaseBuildSha.orElse("unknown").get()),
            )
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    buildFeatures {
        buildConfig = true
        compose = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

ksp {
    // Keep generated Room schema evidence outside the hand-written source tree.
    arg("room.schemaLocation", "$projectDir/schemas")
}

// Do the release-identity validation at execution time so debug source/lint
// work stays possible without secrets. The task is still stopped before its
// output is published or signed if any external release value is absent.
tasks.configureEach {
    if (name.contains("Release", ignoreCase = true)) {
        doFirst {
            requireReleaseValue("WORKFORCE_APPLICATION_ID", releaseApplicationId.orNull)
            requireReleaseValue("WORKFORCE_API_BASE_URL", releaseApiBaseUrl.orNull)
            requireReleaseValue("WORKFORCE_VERSION_NAME", releaseVersionName.orNull)
            requireReleaseValue("WORKFORCE_VERSION_CODE", releaseVersionCode.orNull)
            requireReleaseValue("WORKFORCE_BUILD_SHA", releaseBuildSha.orNull)
            check(releaseApplicationId.orNull?.matches(Regex("[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+")) == true) {
                "WORKFORCE_APPLICATION_ID must be a valid Android application ID."
            }
            check(releaseApiBaseUrl.orNull?.startsWith("https://") == true) {
                "WORKFORCE_API_BASE_URL must use HTTPS."
            }
            check(releaseVersionName.orNull?.matches(Regex("(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)")) == true) {
                "WORKFORCE_VERSION_NAME must be release semver MAJOR.MINOR.PATCH."
            }
            check(releaseVersionCode.orNull?.toIntOrNull()?.let { it > 0 } == true) {
                "WORKFORCE_VERSION_CODE must be a positive integer."
            }
            check(releaseBuildSha.orNull?.matches(Regex("[0-9a-f]{40}")) == true) {
                "WORKFORCE_BUILD_SHA must be the lowercase 40-character immutable Git commit SHA."
            }
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.19.0")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.10.0")
    implementation("androidx.room:room-runtime:2.8.4")
    implementation("androidx.room:room-ktx:2.8.4")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("androidx.work:work-runtime-ktx:2.11.2")
    // Stable compatibility prompt for a per-use Android Keystore signature.
    // The app receives only success/failure and never biometric material.
    implementation("androidx.biometric:biometric:1.1.0")
    // Delegated Google Code Scanner opens its own privacy-preserving scanner
    // surface; the Workforce app itself never receives camera frames.
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")

    val composeBom = platform("androidx.compose:compose-bom:2026.08.00")
    implementation(composeBom)
    androidTestImplementation(composeBom)
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    ksp("androidx.room:room-compiler:2.8.4")
}
