import 'dotenv/config';

export default {
  expo: {
    name: "AI Icons",
    slug: "ai-icon-generator",
    version: "1.0.25",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "light",
    scheme: "icongenerator",
    plugins: [
      "expo-web-browser",
      "expo-localization",
      "expo-router"
    ],
    updates: {
      fallbackToCacheTimeout: 0,
      enabled: false
    },
    splash: {
      image: "./assets/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#ffffff"
    },
    extra: {
      eas: {
        projectId: "476b1941-3351-4a55-9b46-10739188f29c"
      },
      EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
      EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.watson.AI-Icon-Generator",
      buildNumber: "23",
      icon: "./assets/icon.png",
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSPhotoLibraryUsageDescription: "This app needs access to your photo library to save generated icons.",
        NSPhotoLibraryAddUsageDescription: "This app needs permission to save icons to your photo library."
      },
      usesAppleSignIn: true
    },
    android: {
      package: "com.watsonsweb.icongenerator",
      versionCode: 15,
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#ffffff"
      },
      permissions: [
        "WRITE_EXTERNAL_STORAGE",
        "com.android.vending.BILLING"
      ],
      intentFilters: [
        {
          action: "VIEW",
          autoVerify: false,
          data: [
            {
              scheme: "icongenerator",
              host: "auth"
            }
          ],
          category: ["BROWSABLE", "DEFAULT"]
        },
        {
          action: "VIEW",
          autoVerify: true,
          data: [
            {
              scheme: "https",
              host: "eutvdhgxgwrfrrwxuuvp.supabase.co",
              pathPrefix: "/auth/v1/callback"
            }
          ],
          category: ["BROWSABLE", "DEFAULT"]
        }
      ]
    },
    web: {
      favicon: "./assets/favicon.png"
    }
  },
};