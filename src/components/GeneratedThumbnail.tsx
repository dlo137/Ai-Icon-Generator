import { View, TouchableOpacity, Image, Text, Alert } from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import { saveThumbnail } from '../utils/thumbnailStorage';
import Svg, { Path } from 'react-native-svg';

// Create a mock function for development
const mockIsUserSubscribed = async () => {
  // In Expo Go, assume user is subscribed for testing
  return true;
};

// Conditionally import subscription utility
let isUserSubscribed: any = mockIsUserSubscribed;
try {
  const subscriptionUtils = require('../utils/subscriptionStorage');
  isUserSubscribed = subscriptionUtils.isUserSubscribed;
} catch (error) {
  console.log('Using mock subscription check for development');
}

interface GeneratedThumbnailProps {
  imageUrl: string;
  prompt: string;
  onEdit: () => void;
  style: any;
  textOverlay?: {
    text: string;
    x: number;
    y: number;
    scale: number;
    rotation: number;
  };
}

export default function GeneratedThumbnail({ imageUrl, prompt, onEdit, style, textOverlay }: GeneratedThumbnailProps) {
  const downloadThumbnail = async () => {
    if (!imageUrl) {
      Alert.alert('Error', 'No thumbnail to download');
      return;
    }

    try {
      // Request media library permissions
      const permissionResult = await MediaLibrary.requestPermissionsAsync();
      if (!permissionResult || permissionResult.status !== 'granted') {
        Alert.alert('Permission Denied', 'We need permission to save images to your photo library');
        return;
      }

      // If the image is already local, just save it directly
      if (imageUrl.startsWith('file://')) {
        const asset = await MediaLibrary.createAssetAsync(imageUrl);
        await MediaLibrary.createAlbumAsync('Icons', asset, false);
        Alert.alert('Success', 'Icon saved to your photo library!');
        return;
      }

      // Download the image to a temporary location if it's a remote URL
      const fileUri = FileSystem.documentDirectory + `icon_${Date.now()}.jpg`;
      const downloadResult = await FileSystem.downloadAsync(imageUrl, fileUri);

      if (downloadResult.status !== 200) {
        throw new Error('Failed to download image');
      }

      // Save to media library
      const asset = await MediaLibrary.createAssetAsync(downloadResult.uri);
      await MediaLibrary.createAlbumAsync('Icons', asset, false);

      Alert.alert('Success', 'Icon saved to your photo library!');

    } catch (error) {
      console.error('Download error:', error);
      Alert.alert('Error', 'Failed to save icon. Please try again.');
    }
  };

  return (
    <View style={style.imageWrapper}>
      <TouchableOpacity onPress={onEdit} activeOpacity={0.8}>
        <View style={{ position: 'relative' }}>
          <Image
            key={imageUrl}
            source={{ uri: imageUrl }}
            style={style.generatedImage}
            resizeMode="cover"
          />
          {/* Text overlay display */}
          {textOverlay && (
            <View
              style={{
                position: 'absolute',
                left: `${textOverlay.x * 100}%`,
                top: `${textOverlay.y * 100}%`,
                transform: [
                  { scale: textOverlay.scale },
                  { rotate: `${textOverlay.rotation}deg` }
                ],
                pointerEvents: 'none', // Allow touch events to pass through to image
              }}
            >
              <Text
                style={{
                  fontSize: 40,
                  fontWeight: 'bold',
                  color: '#ffffff',
                  textShadowColor: 'rgba(0, 0, 0, 0.75)',
                  textShadowOffset: { width: 2, height: 2 },
                  textShadowRadius: 4
                }}
              >
                {textOverlay.text}
              </Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
      <View style={style.imageActions}>
        <TouchableOpacity
          style={style.saveIcon}
          onPress={async () => {
            try {
              const editsToSave = textOverlay ? {
                textOverlay: textOverlay
              } : null;
              await saveThumbnail(prompt, imageUrl, editsToSave);
              Alert.alert('Saved!', 'Thumbnail saved to your history');
            } catch (error) {
              console.error('Save error:', error);
              Alert.alert('Error', 'Failed to save thumbnail');
            }
          }}
        >
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
            <Path
              d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
              fill="#ffffff"
            />
          </Svg>
        </TouchableOpacity>
        <TouchableOpacity
          style={style.downloadIcon}
          onPress={downloadThumbnail}
        >
          <Text style={style.downloadArrow}>↓</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={style.editButton}
          onPress={onEdit}
        >
          <Text style={style.editText}>Edit</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}