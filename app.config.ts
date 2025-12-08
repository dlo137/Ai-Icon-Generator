import 'dotenv/config';

export default {
  expo: {
    name: "Ai Icon Generator",
    slug: "ai-icon-generator",
    version: "1.0.16",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "light",
    scheme: "thumbnailgen",
    plugins: [
      "expo-web-browser"
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
        projectId: "c1df1c80-b01c-45b2-bd7f-87e1a6b25e15"
      },
      EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
      EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.watsonsweb.thumbnail-generator",
      buildNumber: "14",
      icon: "./assets/icon.png",
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSPhotoLibraryUsageDescription: "This app needs access to your photo library to save generated icons.",
        NSPhotoLibraryAddUsageDescription: "This app needs permission to save icons to your photo library."
      },
      usesAppleSignIn: true
    },
    android: {
      package: "com.aidawrapper.ThumbnailGenerator",
      versionCode: 14,
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
              scheme: "thumbnailgen",
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