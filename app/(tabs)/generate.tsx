import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Platform, Alert, KeyboardAvoidingView, Keyboard, Animated, Image, Modal, PanResponder, TouchableWithoutFeedback } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useState, useEffect, useRef } from 'react';
import Svg, { Path, Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { PinchGestureHandler, PanGestureHandler, RotationGestureHandler, State, GestureHandlerRootView } from 'react-native-gesture-handler';
import { supabase } from '../../lib/supabase';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import GeneratedThumbnail from '../../src/components/GeneratedThumbnail';
import { saveThumbnail, addThumbnailToHistory, getSavedThumbnails, SavedThumbnail } from '../../src/utils/thumbnailStorage';
import { getCredits, deductCredit } from '../../src/utils/subscriptionStorage';
import { useCredits } from '../../src/contexts/CreditsContext';
import Constants from 'expo-constants';

// Create Animated SVG components
const AnimatedRect = Animated.createAnimatedComponent(Rect);

// Utility function to upload image to Supabase Storage
const uploadImageToStorage = async (imageUri: string, fileName: string): Promise<string | null> => {
  try {
    // Get auth session - REQUIRED for user isolation
    const { data: { session } } = await supabase.auth.getSession();
    const authToken = session?.access_token;
    const userId = session?.user?.id;

    if (!userId) {
      return null;
    }

    // Create a unique filename
    const fileExt = imageUri.split('.').pop() || 'jpg';
    const uniqueFileName = `${fileName}_${Date.now()}.${fileExt}`;

    // IMPORTANT: Namespace by user ID to ensure proper isolation
    const userFilePath = `${userId}/${uniqueFileName}`;

    // Create FormData with the image file
    const formData = new FormData();

    // In React Native, we can append the image directly from the URI
    formData.append('file', {
      uri: imageUri,
      name: uniqueFileName,
      type: `image/${fileExt}`,
    } as any);

    // Upload directly to Supabase Storage using fetch
    const supabaseUrl = Constants.expoConfig?.extra?.EXPO_PUBLIC_SUPABASE_URL || '';
    const supabaseKey = Constants.expoConfig?.extra?.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

    if (!supabaseUrl || !supabaseKey) {
      return null;
    }

    // Upload to user-specific folder
    const uploadUrl = `${supabaseUrl}/storage/v1/object/thumbnails/${userFilePath}`;

    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'apikey': supabaseKey,
      },
      body: formData,
    });

    if (!uploadResponse.ok) {
      return null;
    }

    // Get signed URL using the user-specific path
    const { data: urlData } = await supabase.storage
      .from('thumbnails')
      .createSignedUrl(userFilePath, 3600); // 1 hour expiry

    return urlData?.signedUrl || null;
  } catch (error) {
    return null;
  }
};

export default function GenerateScreen() {
  const { credits, refreshCredits } = useCredits();
  const [topic, setTopic] = useState('');
  const [duration, setDuration] = useState(''); // kept for existing logic
  const [style, setStyle] = useState('educational'); // kept for existing logic
  const [isLoading, setIsLoading] = useState(false);
  const dot1Anim = useRef(new Animated.Value(0)).current;
  const dot2Anim = useRef(new Animated.Value(0)).current;
  const dot3Anim = useRef(new Animated.Value(0)).current;
  const shimmer1Anim = useRef(new Animated.Value(0.3)).current;
  const shimmer2Anim = useRef(new Animated.Value(0.3)).current;
  const shimmer3Anim = useRef(new Animated.Value(0.3)).current;
  const borderOffset1 = useRef(new Animated.Value(0)).current;
  const borderOffset2 = useRef(new Animated.Value(0)).current;
  const borderOffset3 = useRef(new Animated.Value(0)).current;
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [generatedImageUrl, setGeneratedImageUrl] = useState('');
  const [generatedImageUrl2, setGeneratedImageUrl2] = useState('');
  const [generatedImageUrl3, setGeneratedImageUrl3] = useState('');
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [customTitle, setCustomTitle] = useState<string | null>(null);
  const [financeLastUsed, setFinanceLastUsed] = useState<number[]>([]);
  const [fitnessLastUsed, setFitnessLastUsed] = useState<number[]>([]);
  const [photoLastUsed, setPhotoLastUsed] = useState<number[]>([]);
  const [modalPrompt, setModalPrompt] = useState('');
  const [modalImageUrl, setModalImageUrl] = useState('');
  const [originalModalImageUrl, setOriginalModalImageUrl] = useState(''); // Track original remote URL for syncing
  const [selectedTool, setSelectedTool] = useState<'save' | 'erase' | 'text' | null>(null);
  const [eraseMask, setEraseMask] = useState<string>('');
  const [currentErasePath, setCurrentErasePath] = useState<string>('');
  const erasePathRef = useRef<string>('');
  const [showEraseConfirm, setShowEraseConfirm] = useState(false);
  const [textSticker, setTextSticker] = useState<{
    text: string;
    x: number;
    y: number;
    scale: number;
    rotation: number;
  } | null>(null);
  // Animated values for gesture deltas only
  const textStickerPanDelta = useRef(new Animated.ValueXY()).current;
  const textStickerScaleDelta = useRef(new Animated.Value(1)).current;
  const textStickerRotationDelta = useRef(new Animated.Value(0)).current;
  // Base animated values (updated from state)
  const textStickerBaseX = useRef(new Animated.Value(0)).current;
  const textStickerBaseY = useRef(new Animated.Value(0)).current;
  const textStickerBaseScale = useRef(new Animated.Value(1)).current;
  const textStickerBaseRotation = useRef(new Animated.Value(0)).current;
  const [textElements, setTextElements] = useState<Array<{id: string, text: string, x: number, y: number, color: string, fontSize: number}>>([]);
  const [isAddingText, setIsAddingText] = useState(false);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [isSubjectModalVisible, setIsSubjectModalVisible] = useState(false);
  const [isReferenceModalVisible, setIsReferenceModalVisible] = useState(false);
  const [subjectImage, setSubjectImage] = useState<string | null>(null);
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [subjectImageUrl, setSubjectImageUrl] = useState<string | null>(null);
  const [referenceImageUrls, setReferenceImageUrls] = useState<string[]>([]);
  const [thumbnailEdits, setThumbnailEdits] = useState<{
    imageUrl: string;
    textOverlay?: {
      text: string;
      x: number;
      y: number;
      scale: number;
      rotation: number;
    };
  } | null>(null);
  const [scale, setScale] = useState(1);
  const [modalKeyboardHeight, setModalKeyboardHeight] = useState(0);
  const [isModalGenerating, setIsModalGenerating] = useState(false);
  const [translateX, setTranslateX] = useState(0);
  const [translateY, setTranslateY] = useState(0);
  const scaleValue = useRef(new Animated.Value(1));
  const translateXValue = useRef(new Animated.Value(0));
  const translateYValue = useRef(new Animated.Value(0));
  const [lastPrompt, setLastPrompt] = useState('');
  const [allGenerations, setAllGenerations] = useState<Array<{
    id: string;
    prompt: string;
    url1: string;
    url2?: string;
    url3?: string;
    timestamp: number;
    customTitle?: string | null;
    textOverlays?: {
      url1?: {
        text: string;
        x: number;
        y: number;
        scale: number;
        rotation: number;
      };
      url2?: {
        text: string;
        x: number;
        y: number;
        scale: number;
        rotation: number;
      };
      url3?: {
        text: string;
        x: number;
        y: number;
        scale: number;
        rotation: number;
      };
    };
  }>>([]);
  const [imageContainerDimensions, setImageContainerDimensions] = useState({ width: 0, height: 0 });
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (isLoading || isModalGenerating) {
      // Animation for loading dots in button
      const createFloatingAnimation = (animValue: Animated.Value, delay: number) => {
        return Animated.loop(
          Animated.sequence([
            Animated.timing(animValue, {
              toValue: -6,
              duration: 500,
              delay,
              useNativeDriver: true,
            }),
            Animated.timing(animValue, {
              toValue: 0,
              duration: 500,
              useNativeDriver: true,
            }),
          ])
        );
      };

      // Shimmer animation for loading skeletons
      const createShimmerAnimation = (animValue: Animated.Value, delay: number) => {
        return Animated.loop(
          Animated.sequence([
            Animated.timing(animValue, {
              toValue: 1,
              duration: 800,
              delay,
              useNativeDriver: true,
            }),
            Animated.timing(animValue, {
              toValue: 0.3,
              duration: 800,
              useNativeDriver: true,
            }),
          ])
        );
      };

      // Border offset animation - travels the gradient along the border
      const createBorderOffsetAnimation = (animValue: Animated.Value) => {
        return Animated.loop(
          Animated.timing(animValue, {
            toValue: 1000, // Total perimeter approximation
            duration: 2500,
            useNativeDriver: false, // Can't use native driver for SVG props
          })
        );
      };

      const animation1 = createFloatingAnimation(dot1Anim, 0);
      const animation2 = createFloatingAnimation(dot2Anim, 150);
      const animation3 = createFloatingAnimation(dot3Anim, 300);

      const shimmer1 = createShimmerAnimation(shimmer1Anim, 0);
      const shimmer2 = createShimmerAnimation(shimmer2Anim, 200);
      const shimmer3 = createShimmerAnimation(shimmer3Anim, 400);

      const borderAnim1 = createBorderOffsetAnimation(borderOffset1);
      const borderAnim2 = createBorderOffsetAnimation(borderOffset2);
      const borderAnim3 = createBorderOffsetAnimation(borderOffset3);

      animation1.start();
      animation2.start();
      animation3.start();
      shimmer1.start();
      shimmer2.start();
      shimmer3.start();
      borderAnim1.start();
      borderAnim2.start();
      borderAnim3.start();

      return () => {
        animation1.stop();
        animation2.stop();
        animation3.stop();
        shimmer1.stop();
        shimmer2.stop();
        shimmer3.stop();
        borderAnim1.stop();
        borderAnim2.stop();
        borderAnim3.stop();
        dot1Anim.setValue(0);
        dot2Anim.setValue(0);
        dot3Anim.setValue(0);
        borderOffset1.setValue(0);
        borderOffset2.setValue(0);
        borderOffset3.setValue(0);
      };
    }
  }, [isLoading, isModalGenerating]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const keyboardShowListener = Keyboard.addListener(showEvent, (event) => {
      if (isModalVisible) {
        setModalKeyboardHeight(event.endCoordinates.height);
      } else {
        setKeyboardHeight(event.endCoordinates.height);
      }
    });

    const keyboardHideListener = Keyboard.addListener(hideEvent, () => {
      if (isModalVisible) {
        setModalKeyboardHeight(0);
      } else {
        setKeyboardHeight(0);
      }
    });

    return () => {
      keyboardShowListener.remove();
      keyboardHideListener.remove();
    };
  }, [isModalVisible]);


  const downloadThumbnail = async () => {
    if (!generatedImageUrl) {
      Alert.alert('Error', 'No icon to download');
      return;
    }

    try {
      // Request permissions
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please grant photo library access to save icons');
        return;
      }

      // Download the image to local filesystem
      const filename = `icon_${Date.now()}.png`;
      const docDir = FileSystem.documentDirectory;
      if (!docDir) {
        throw new Error('Document directory not available');
      }
      const localUri = `${docDir}${filename}`;

      const downloadResult = await FileSystem.downloadAsync(generatedImageUrl, localUri);

      // Save to photo library
      const asset = await MediaLibrary.createAssetAsync(downloadResult.uri);
      await MediaLibrary.createAlbumAsync('AI Icons', asset, false);

      Alert.alert('Success', 'Icon saved to your photo library!');

    } catch (error) {
      console.error('Download error:', error);
      Alert.alert('Error', 'Failed to save icon. Please try again.');
    }
  };

  const openModal = async (imageUrl: string) => {
    setModalPrompt('');
    setModalImageUrl(imageUrl);
    setOriginalModalImageUrl(imageUrl); // Save the original remote URL
    setIsModalVisible(true);

    // First check if this image has text overlay in current generation
    const currentGeneration = allGenerations.find(gen =>
      gen.url1 === imageUrl || gen.url2 === imageUrl || gen.url3 === imageUrl
    );

    let textOverlayFromGeneration = null;
    if (currentGeneration) {
      if (currentGeneration.url1 === imageUrl) {
        textOverlayFromGeneration = currentGeneration.textOverlays?.url1;
      } else if (currentGeneration.url2 === imageUrl) {
        textOverlayFromGeneration = currentGeneration.textOverlays?.url2;
      } else if (currentGeneration.url3 === imageUrl) {
        textOverlayFromGeneration = currentGeneration.textOverlays?.url3;
      }
    }

    // Check if this image has existing saved edits
    try {
      const savedThumbnails = await getSavedThumbnails();
      const existingThumbnail = savedThumbnails.find((thumb: SavedThumbnail) => 
        thumb.imageUrl === imageUrl || 
        thumb.imageUrl.includes(imageUrl.split('/').pop() || '')
      );

      // Prioritize current generation overlay over saved overlay
      let textOverlay = textOverlayFromGeneration || existingThumbnail?.edits?.textOverlay;

      // Backward compatibility: Convert old absolute positions to relative
      if (textOverlay && textOverlay.x > 1 && textOverlay.y > 1) {
        // This appears to be old absolute positioning data, convert to relative
        // Assume original modal was roughly 350x200 based on common mobile dimensions
        const assumedModalWidth = 350;
        const assumedModalHeight = 200;
        textOverlay = {
          ...textOverlay,
          x: Math.min(1, textOverlay.x / assumedModalWidth),
          y: Math.min(1, textOverlay.y / assumedModalHeight)
        };
      }

      if (textOverlay) {
        // Load existing text overlay
        setThumbnailEdits({
          imageUrl,
          textOverlay: textOverlay
        });
      } else {
        // Initialize new edits for this image
        setThumbnailEdits({
          imageUrl
        });
      }
    } catch (error) {
      // Fallback to initialize new edits
      setThumbnailEdits({
        imageUrl
      });
    }
  };

  const handleModalGenerate = async () => {
    if (!modalPrompt.trim()) {
      Alert.alert('Error', 'Please enter a description for your adjustment');
      return;
    }

    // Check credits before generating edit
    const creditsCheck = await getCredits();
    if (creditsCheck.current <= 0) {
      Alert.alert(
        'No Credits Remaining',
        'You have used all your credits. Your credits will reset based on your subscription plan.',
        [{ text: 'OK' }]
      );
      return;
    }

    setIsModalGenerating(true);
    Keyboard.dismiss();

    try {
      // Find the current generation to get the original prompt
      const currentGeneration = allGenerations.find(gen =>
        gen.url1 === modalImageUrl || gen.url2 === modalImageUrl || gen.url3 === modalImageUrl
      );

      if (!currentGeneration) {
        Alert.alert('Error', 'Could not find original icon');
        return;
      }

      // Create edit-aware prompt
      let enhancedPrompt = modalPrompt.trim();


      // Create an adjustment-focused prompt
      // For zoom/framing requests, allow composition changes
      const isFramingAdjustment = /zoom|show more|show less|pull back|widen|closer|crop|frame|padding|margin/i.test(enhancedPrompt);

      const fullPrompt = isFramingAdjustment
        ? `Original icon: "${currentGeneration.prompt}". Adjustment: ${enhancedPrompt}. Keep the same content and style, but adjust the framing/composition as requested.`
        : `Keep the exact same composition, layout, and core elements from this icon: "${currentGeneration.prompt}". Only make this specific adjustment: ${enhancedPrompt}. Do not change the overall design, just modify the requested aspect while maintaining everything else identical.`;

      // Only use images that are actively selected for adjustment mode
      const activeSubjectImageUrl = subjectImage ? subjectImageUrl : null;
      const activeReferenceImageUrls = referenceImages.length > 0 ? referenceImageUrls : [];

      // Call the generation API with the current image as reference
      const { data, error } = await supabase.functions.invoke('generate-thumbnail', {
        body: {
          prompt: fullPrompt,
          style: style,
          baseImageUrl: modalImageUrl, // Provide current image as reference for adjustments
          adjustmentMode: true, // Flag to indicate this is an adjustment, not new generation
          subjectImageUrl: activeSubjectImageUrl, // Only include if actively selected
          referenceImageUrls: activeReferenceImageUrls, // Only include if actively selected
        },
      });

      if (error) {
        Alert.alert('Error', `Failed to generate adjustment: ${error.message || 'Unknown error'}`);
        return;
      }

      if (data?.error) {
        Alert.alert('Error', data.error || 'Failed to generate icon adjustment');
        return;
      }

      // Get the new image URL
      const newImageUrl = data?.variation1?.imageUrl || data?.imageUrl;
      if (!newImageUrl || !newImageUrl.trim()) {
        Alert.alert('Error', 'No adjusted image was generated. Please try again.');
        return;
      }

      // Validate the URL is properly formed
      if (!newImageUrl.startsWith('http') && !newImageUrl.startsWith('file://')) {
        Alert.alert('Error', 'Invalid image URL received. Please try again.');
        return;
      }

      // Update the current generation in the list with the new URL
      setAllGenerations(prev => prev.map(gen => {
        if (gen.id === currentGeneration.id) {
          // Update the URL that was being edited, but only if the new URL is valid
          if (gen.url1 === modalImageUrl && newImageUrl) {
            return { ...gen, url1: newImageUrl };
          } else if (gen.url2 === modalImageUrl && newImageUrl) {
            return { ...gen, url2: newImageUrl };
          }
        }
        return gen;
      }));

      // Update modal to show the new image
      setModalImageUrl(newImageUrl);

      // Clear the edits for the new image
      setThumbnailEdits({
        imageUrl: newImageUrl
      });
      setModalPrompt('');

      // Deduct 1 credit for successful edit (only 1 image generated in edit mode)
      await deductCredit(1);

      // Refresh credits display immediately
      await refreshCredits();

      Alert.alert('Success!', 'Your icon has been adjusted');

    } catch (error) {
      Alert.alert('Error', 'Something went wrong. Please check your connection and try again.');
    } finally {
      setIsModalGenerating(false);
    }
  };

  const closeModal = () => {
    setIsModalVisible(false);
    setModalPrompt('');
    setModalImageUrl('');
    setOriginalModalImageUrl('');
    setSelectedTool(null);
    setTextElements([]);
    setIsAddingText(false);
    setSelectedTextId(null);
    setModalKeyboardHeight(0);
    // Clear text overlay states
    setTextSticker(null);
    setThumbnailEdits(null);
    // Reset zoom and pan
    setScale(1);
    setTranslateX(0);
    setTranslateY(0);
    scaleValue.current.setValue(1);
    translateXValue.current.setValue(0);
    translateYValue.current.setValue(0);
    // Reset text sticker animations
    textStickerPanDelta.setValue({ x: 0, y: 0 });
    textStickerScaleDelta.setValue(1);
    textStickerRotationDelta.setValue(0);
    textStickerBaseX.setOffset(0);
    textStickerBaseY.setOffset(0);
    textStickerBaseX.setValue(0);
    textStickerBaseY.setValue(0);
    textStickerBaseScale.setValue(1);
    textStickerBaseRotation.setValue(0);
  };

  const getShortTitle = (prompt: string) => {
    // Clean the prompt
    const cleanPrompt = prompt.trim();

    // Words to remove at the start of prompts (imperatives/filler)
    const prefixesToRemove = [
      'create a', 'create an', 'make a', 'make an', 'generate a', 'generate an',
      'design a', 'design an', 'show a', 'show an', 'i want a', 'i want an',
      'i need a', 'i need an', 'give me a', 'give me an'
    ];

    // Remove common prefixes (case insensitive)
    let workingPrompt = cleanPrompt.toLowerCase();
    for (const prefix of prefixesToRemove) {
      if (workingPrompt.startsWith(prefix)) {
        workingPrompt = cleanPrompt.substring(prefix.length).trim();
        break;
      }
    }

    // If we removed a prefix, use the cleaned version, otherwise use original
    const basePrompt = workingPrompt === cleanPrompt.toLowerCase() ? cleanPrompt : workingPrompt;

    // Words that should be removed from anywhere in the title
    const fillerWords = [
      'icon', 'app icon', 'image', 'picture', 'photo',
      'for app', 'for my', 'for a', 'that shows', 'that has',
      'featuring', 'with a', 'with an'
    ];

    let processedPrompt = basePrompt;
    for (const filler of fillerWords) {
      processedPrompt = processedPrompt.replace(new RegExp(`\\b${filler}\\b`, 'gi'), '');
    }

    // Clean up extra spaces and punctuation
    processedPrompt = processedPrompt
      .replace(/\s+/g, ' ')
      .replace(/[.,!?;:]+$/g, '')
      .trim();

    // Helper function to limit to 3 words max
    const limitWords = (text: string, max: number = 3): string => {
      const words = text.split(/\s+/).filter(w => w.length > 0);
      return words.slice(0, max).join(' ');
    };

    // Helper function to capitalize
    const capitalize = (text: string): string => {
      return text
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
    };

    const words = processedPrompt.split(/\s+/);

    // If already short enough, just capitalize
    if (words.length <= 3) {
      return capitalize(processedPrompt);
    }

    // For longer prompts, try to extract the core concept (max 3 words)
    // Look for key patterns: "X vs Y", "X Review", etc.
    const patterns = [
      { regex: /(.+?)\s+vs\s+(.+)/i, format: (m: RegExpMatchArray) => limitWords(`${m[1]} vs ${m[2]}`, 3) },
      { regex: /(.+?)\s+review/i, format: (m: RegExpMatchArray) => limitWords(`${m[1]} Review`, 2) },
      { regex: /(.+?)\s+tutorial/i, format: (m: RegExpMatchArray) => limitWords(`${m[1]} Tutorial`, 2) },
      { regex: /(.+?)\s+guide/i, format: (m: RegExpMatchArray) => limitWords(`${m[1]} Guide`, 2) },
      { regex: /(.+?)\s+playing\s+(.+)/i, format: (m: RegExpMatchArray) => limitWords(`${m[1]} ${m[2]}`, 2) },
      { regex: /(.+?)\s+in\s+(.+)/i, format: (m: RegExpMatchArray) => limitWords(`${m[1]} ${m[2]}`, 2) },
    ];

    for (const pattern of patterns) {
      const match = processedPrompt.match(pattern.regex);
      if (match) {
        const title = pattern.format(match);
        return capitalize(title);
      }
    }

    // If no pattern matched, take first 3 words as the title
    const titleWords = words.slice(0, 3).join(' ');
    return capitalize(titleWords);
  };




  const onPinchGestureEvent = (event: any) => {
    const { scale: newScale } = event.nativeEvent;
    const clampedScale = Math.max(0.5, Math.min(newScale, 3)); // Min 0.5x, Max 3x
    scaleValue.current.setValue(clampedScale);
  };

  const onPinchHandlerStateChange = (event: any) => {
    if (event.nativeEvent.state === State.END) {
      const { scale: newScale } = event.nativeEvent;
      const clampedScale = Math.max(0.5, Math.min(newScale, 3));
      setScale(clampedScale);
      scaleValue.current.setValue(clampedScale);
    }
  };

  const onPanGestureEvent = (event: any) => {
    if (scale > 1) {
      const { translationX, translationY } = event.nativeEvent;
      translateXValue.current.setValue(translationX);
      translateYValue.current.setValue(translationY);
    }
  };

  const onPanHandlerStateChange = (event: any) => {
    if (event.nativeEvent.state === State.END && scale > 1) {
      const { translationX, translationY } = event.nativeEvent;
      setTranslateX(prev => prev + translationX);
      setTranslateY(prev => prev + translationY);
      translateXValue.current.setOffset(translateX + translationX);
      translateYValue.current.setOffset(translateY + translationY);
      translateXValue.current.setValue(0);
      translateYValue.current.setValue(0);
    }
  };

  const erasePanResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => selectedTool === 'erase',
    onMoveShouldSetPanResponder: () => selectedTool === 'erase',
    onStartShouldSetPanResponderCapture: () => selectedTool === 'erase',
    onMoveShouldSetPanResponderCapture: () => selectedTool === 'erase',
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,

    onPanResponderGrant: (evt) => {
      if (selectedTool !== 'erase') return;
      const { locationX, locationY } = evt.nativeEvent;
      const newPath = `M${locationX.toFixed(2)},${locationY.toFixed(2)}`;
      erasePathRef.current = newPath;
      setCurrentErasePath(newPath);
      setShowEraseConfirm(false);
    },

    onPanResponderMove: (evt) => {
      if (selectedTool !== 'erase') return;
      const { locationX, locationY } = evt.nativeEvent;
      const updatedPath = `${erasePathRef.current} L${locationX.toFixed(2)},${locationY.toFixed(2)}`;
      erasePathRef.current = updatedPath;
      setCurrentErasePath(updatedPath);
    },

    onPanResponderRelease: () => {
      if (selectedTool !== 'erase' || !erasePathRef.current) return;
      setEraseMask(erasePathRef.current);
      setShowEraseConfirm(true);
    },

    onPanResponderTerminate: () => {
      if (selectedTool === 'erase' && erasePathRef.current) {
        setEraseMask(erasePathRef.current);
        setShowEraseConfirm(true);
      }
    },
  });

  // Text sticker gesture handlers - only write to delta values during gesture
  const onTextPanGestureEvent = Animated.event(
    [{ nativeEvent: { translationX: textStickerPanDelta.x, translationY: textStickerPanDelta.y } }],
    { useNativeDriver: false }
  );

  const onTextPinchGestureEvent = Animated.event(
    [{ nativeEvent: { scale: textStickerScaleDelta } }],
    { useNativeDriver: false }
  );

  const onTextRotationGestureEvent = Animated.event(
    [{ nativeEvent: { rotation: textStickerRotationDelta } }],
    { useNativeDriver: false }
  );

  // On gesture end, commit deltas to state once, then reset deltas
  const onTextPanStateChange = (event: any) => {
    if (event.nativeEvent.state === State.END && textSticker) {
      const { translationX, translationY } = event.nativeEvent;

      // Get current offset values (the actual position)
      const currentX = (textStickerBaseX as any)._offset || 0;
      const currentY = (textStickerBaseY as any)._offset || 0;

      // Calculate new position from current offset + translation
      let newX = currentX + translationX;
      let newY = currentY + translationY;

      // Clamp to image bounds (with minimal padding)
      const padding = 10;
      const estimatedTextWidth = 200; // Approximate width of text element
      const estimatedTextHeight = 80; // Approximate height of text element

      if (imageContainerDimensions.width > 0) {
        // Allow text to go closer to edges
        newX = Math.max(-estimatedTextWidth / 2, Math.min(newX, imageContainerDimensions.width - estimatedTextWidth / 2));
      }
      if (imageContainerDimensions.height > 0) {
        newY = Math.max(-estimatedTextHeight / 2, Math.min(newY, imageContainerDimensions.height - estimatedTextHeight / 2));
      }

      // Commit to state
      setTextSticker(prev => prev ? {
        ...prev,
        x: newX,
        y: newY
      } : null);

      // IMPORTANT: Set offset before setting value to prevent jumping
      textStickerBaseX.setOffset(newX);
      textStickerBaseY.setOffset(newY);

      // Reset the base values and delta to 0
      textStickerBaseX.setValue(0);
      textStickerBaseY.setValue(0);
      textStickerPanDelta.setValue({ x: 0, y: 0 });
    }
  };

  const onTextPinchStateChange = (event: any) => {
    if (event.nativeEvent.state === State.END && textSticker) {
      const scaleDelta = event.nativeEvent.scale;
      const newScale = textSticker.scale * scaleDelta;

      // Commit to state
      setTextSticker(prev => prev ? {
        ...prev,
        scale: newScale
      } : null);

      // Update base value and reset delta
      textStickerBaseScale.setValue(newScale);
      textStickerScaleDelta.setValue(1);
    }
  };

  const onTextRotationStateChange = (event: any) => {
    if (event.nativeEvent.state === State.END && textSticker) {
      const rotationDelta = event.nativeEvent.rotation;
      const newRotation = textSticker.rotation + rotationDelta;

      // Commit to state
      setTextSticker(prev => prev ? {
        ...prev,
        rotation: newRotation
      } : null);

      // Update base value and reset delta
      textStickerBaseRotation.setValue(newRotation);
      textStickerRotationDelta.setValue(0);
    }
  };

  // kept from original for backwards-compat; do not change functionality
  const thumbnailStyles = [
    { id: 'minimal', label: 'Minimal' },
    { id: 'bold', label: 'Bold & Vibrant' },
    { id: 'retro', label: 'Retro' },
    { id: 'modern', label: 'Modern' },
    { id: 'cinematic', label: 'Cinematic' },
    { id: 'cartoon', label: 'Cartoon' },
    { id: 'dark', label: 'Dark Theme' },
    { id: 'colorful', label: 'Colorful' },
  ];

  // Predefined finance icon prompts that cycle through (following finance color psychology)
  const financeIconPrompts = [
    // 1. Dollar sign - Dark blue (trust)
    "Create a stunning modern finance app icon with ONE bold, centered 3D dollar sign ($) with premium metallic finish. Use glassmorphism with subtle depth. Background must be a rich gradient from midnight navy to royal blue with silver highlights, completely filling edge-to-edge with NO borders. Add soft glow. Must look trustworthy like major bank apps.",

    // 2. Line chart - Green (growth)
    "Create a stunning modern finance app icon with ONE bold, centered upward trending line chart with glowing points. Use clean geometric design. Background must be a rich gradient from deep emerald to bright neon green, completely filling edge-to-edge with NO borders. Add chart glow. Must convey growth and success.",

    // 3. Credit card - Dark blue/white (premium)
    "Create a stunning modern finance app icon with ONE bold, centered credit card with chip detail. Use minimalist premium design. Background must be a rich gradient from midnight blue to deep navy with white/silver card, completely filling edge-to-edge with NO borders. Add subtle shadows. Must look premium and secure.",

    // 4. Wallet - Black + neon (modern fintech)
    "Create a stunning modern finance app icon with ONE bold, centered sleek wallet with glowing edge. Use modern minimalist design. Background must be pure black to dark charcoal with bright neon cyan accent, completely filling edge-to-edge with NO borders. Add neon glow. Must look modern fintech.",

    // 5. Bank building - Dark blue (trust)
    "Create a stunning modern finance app icon with ONE bold, centered geometric bank building with columns. Use clean 3D design. Background must be a rich gradient from royal blue to midnight navy with gold accents, completely filling edge-to-edge with NO borders. Add shadows. Must convey stability.",

    // 6. Columns - Dark blue/gold (institutional)
    "Create a stunning modern finance app icon with ONE bold, centered pair of classical columns. Use elegant geometric design. Background must be a rich gradient from deep navy to royal blue with gold highlights, completely filling edge-to-edge with NO borders. Add depth. Must look institutional and trustworthy.",

    // 7. Shield - Dark blue/green (security)
    "Create a stunning modern finance app icon with ONE bold, centered geometric shield with inner glow. Use modern minimalist design. Background must be a rich gradient from midnight blue to deep teal with emerald accents, completely filling edge-to-edge with NO borders. Add protective glow. Must convey security.",

    // 8. Coin stack - Green/gold (wealth)
    "Create a stunning modern finance app icon with ONE bold, centered stack of glossy coins with reflections. Use 3D metallic design. Background must be a rich gradient from deep forest green to bright emerald with gold highlights, completely filling edge-to-edge with NO borders. Add shine. Must convey wealth.",

    // 9. Piggy bank - Green (savings)
    "Create a stunning modern finance app icon with ONE bold, centered modern piggy bank with clean lines. Use geometric design with subtle 3D. Background must be a rich gradient from deep teal to bright emerald green, completely filling edge-to-edge with NO borders. Add soft glow. Must look friendly yet premium.",

    // 10. Calculator - Black + neon (modern fintech)
    "Create a stunning modern finance app icon with ONE bold, centered calculator with glowing display. Use sleek minimalist design. Background must be pure black to dark charcoal with bright neon green display, completely filling edge-to-edge with NO borders. Add glow effects. Must look modern and precise."
  ];

  // Predefined fitness icon prompts that cycle through (premium design approach)
  const fitnessIconPrompts = [
    // 1. Dumbbell — Premium strength (graphite / steel)
    "Create a premium modern fitness app icon featuring ONE bold, centered dumbbell with brushed steel or graphite finish. Use minimal geometric form with subtle bevels. Background must be a smooth gradient from deep slate blue to dark graphite, edge-to-edge with NO borders. Soft studio lighting, realistic shadows. Clean, professional, high-end fitness branding.",

    // 2. Heart rate / ECG — Health & performance (cool green)
    "Create a premium modern fitness app icon with ONE centered ECG heart rate line, clean and precise. Thin but confident stroke, balanced peaks. Background must be a refined gradient from deep forest green to muted teal, edge-to-edge with NO borders. Subtle glow only at intersections. Medical-grade, calm, trustworthy.",

    // 3. Running figure — Motion without gimmicks (cool gray)
    "Create a premium modern fitness app icon with ONE centered abstract running figure using a simplified, aerodynamic silhouette. No motion blur. Background must be a smooth gradient from dark charcoal to cool steel gray, edge-to-edge with NO borders. Matte finish, soft directional lighting. Athletic, controlled, modern.",

    // 4. Stopwatch — Precision training (black + electric blue)
    "Create a premium modern fitness app icon with ONE centered stopwatch in a minimal digital style. Clean lines, no clutter. Background must be deep black fading into dark navy, edge-to-edge with NO borders. Subtle electric blue accent only on key details. Precise, professional, performance-focused.",

    // 5. Flexed arm — Strength & discipline (monochrome)
    "Create a premium modern fitness app icon with ONE centered flexed arm symbol, sculpted but minimal. Use smooth geometry, no veins or exaggeration. Background must be a gradient from dark stone gray to near-black, edge-to-edge with NO borders. Soft contrast lighting. Strong, disciplined, premium.",

    // 6. Scale — Health tracking (cool neutral)
    "Create a premium modern fitness app icon with ONE centered smart scale, ultra-minimal design. Rounded edges, glass-like surface. Background must be a gradient from muted blue-gray to soft graphite, edge-to-edge with NO borders. Gentle reflections. Clean, modern health tech aesthetic.",

    // 7. Flame — Metabolic burn (reimagined, not aggressive)
    "Create a premium modern fitness app icon with ONE centered abstract flame symbol designed with smooth, minimal curves. No sharp edges, no aggressive glow. Background must be a gradient from deep plum to dark navy, edge-to-edge with NO borders. Soft internal highlights. Controlled intensity, modern fitness.",

    // 8. Footprint — Steps & activity (calm vitality)
    "Create a premium modern fitness app icon with ONE centered shoe footprint icon using a simplified tread pattern. Flat but dimensional. Background must be a gradient from deep evergreen to dark teal, edge-to-edge with NO borders. Subtle depth and shadow. Clean, active, refined.",

    // 9. Water bottle — Hydration (tech wellness)
    "Create a premium modern fitness app icon with ONE centered minimalist water bottle icon. Frosted glass or matte finish. Background must be a smooth gradient from cool cyan-blue to muted navy, edge-to-edge with NO borders. Soft reflections, no droplets. Clean, modern wellness tech.",

    // 10. Meditation — Premium recovery (luxury calm)
    "Create a premium modern fitness app icon with ONE centered meditation figure in lotus pose, ultra-minimal silhouette. Background must be deep charcoal to pure black, edge-to-edge with NO borders. Soft ambient rim light around the figure. Calm, luxurious, high-end coaching brand."
  ];

  // Predefined photo icon prompts that cycle through (premium creative approach)
  const photoIconPrompts = [
    // 1. Camera — Professional photography (charcoal + silver)
    "Create a premium modern photo app icon with ONE centered professional camera body, minimal geometric form with metallic details. Background must be a smooth gradient from deep charcoal to dark slate gray, edge-to-edge with NO borders. Soft studio lighting, realistic shadows. Clean, professional photography aesthetic.",

    // 2. Lens — Optical precision (deep blue + glass)
    "Create a premium modern photo app icon with ONE centered camera lens with glass reflections and minimal aperture details. Background must be a refined gradient from deep navy blue to midnight blue, edge-to-edge with NO borders. Subtle lens flare, optical-grade precision. Professional, trustworthy.",

    // 3. Aperture — Technical precision (monochrome)
    "Create a premium modern photo app icon with ONE centered camera aperture with geometric blade pattern. Background must be a gradient from silver-gray to dark graphite, edge-to-edge with NO borders. Precise mechanical details, soft highlights. Technical, professional, precision photography.",

    // 4. Film strip — Cinematic capture (vintage modern)
    "Create a premium modern photo app icon with ONE centered film strip segment showing minimal sprocket holes. Background must be a gradient from deep sepia to rich brown, edge-to-edge with NO borders. Soft vintage lighting, modern minimal form. Cinematic, professional storytelling."
  ];

  // Generate randomized preset prompts avoiding last 2 selections
  const getRandomizedPresetPrompt = (category: 'finance' | 'fitness' | 'photo'): string => {
    const getRandomAvoidingLast = (arrayLength: number, lastUsed: number[]): number => {
      // Get available indexes (exclude last 2 used)
      const availableIndexes = [];
      for (let i = 0; i < arrayLength; i++) {
        if (!lastUsed.includes(i)) {
          availableIndexes.push(i);
        }
      }
      
      // If we've used too many recently, just avoid the very last one
      if (availableIndexes.length === 0) {
        for (let i = 0; i < arrayLength; i++) {
          if (i !== lastUsed[lastUsed.length - 1]) {
            availableIndexes.push(i);
          }
        }
      }
      
      // Pick random from available
      return availableIndexes[Math.floor(Math.random() * availableIndexes.length)];
    };

    if (category === 'finance') {
      const selectedIndex = getRandomAvoidingLast(financeIconPrompts.length, financeLastUsed);
      const prompt = financeIconPrompts[selectedIndex];
      
      // Update last used (keep only last 2)
      setFinanceLastUsed(prev => {
        const updated = [...prev, selectedIndex];
        return updated.slice(-2); // Keep only last 2
      });
      
      return prompt;
    }
    else if (category === 'fitness') {
      const selectedIndex = getRandomAvoidingLast(fitnessIconPrompts.length, fitnessLastUsed);
      const prompt = fitnessIconPrompts[selectedIndex];
      
      // Update last used (keep only last 2)
      setFitnessLastUsed(prev => {
        const updated = [...prev, selectedIndex];
        return updated.slice(-2); // Keep only last 2
      });
      
      return prompt;
    }
    else { // photo
      const selectedIndex = getRandomAvoidingLast(photoIconPrompts.length, photoLastUsed);
      const prompt = photoIconPrompts[selectedIndex];
      
      // Update last used (keep only last 2)
      setPhotoLastUsed(prev => {
        const updated = [...prev, selectedIndex];
        return updated.slice(-2); // Keep only last 2
      });
      
      return prompt;
    }
  };

  const handleGenerate = async (overrideTopic?: string, overrideCustomTitle?: string) => {
    const topicToUse = overrideTopic || topic;
    const customTitleToUse = overrideCustomTitle || customTitle;

    if (!topicToUse.trim()) {
      Alert.alert('Error', 'Please enter a description for your icon');
      return;
    }

    // Check credits before generating (need 3 credits for 3 images)
    const creditsCheck = await getCredits();
    if (creditsCheck.current < 3) {
      Alert.alert(
        'Insufficient Credits',
        `You need 3 credits to generate images (you have ${creditsCheck.current}). Your credits will reset based on your subscription plan.`,
        [{ text: 'OK' }]
      );
      return;
    }

    // Store the prompt for title display BEFORE clearing
    let promptToUse = topicToUse.trim();

    // Only use images that are actively selected (have local images)
    const activeSubjectImageUrl = subjectImage ? subjectImageUrl : null;
    const activeReferenceImageUrls = referenceImages.length > 0 ? referenceImageUrls : [];

    // Enhance prompt with subject/reference instructions based on actively selected images
    if (activeSubjectImageUrl && activeReferenceImageUrls.length > 0) {
      promptToUse += '. Use the reference image(s) as the exact style and composition template, and replace the main subject/person in the reference with the provided subject image (face swap/body replacement). Maintain the exact background, lighting, pose, and style of the reference.';
    } else if (activeSubjectImageUrl) {
      promptToUse += '. Use the provided subject image as the main focus, incorporating the person/face into the generated icon.';
    } else if (activeReferenceImageUrls.length > 0) {
      promptToUse += '. Use the reference image(s) as inspiration for the style, composition, and overall look of the icon.';
    }

    setLastPrompt(topicToUse.trim()); // Store original prompt for display

    // Dismiss keyboard when generating
    Keyboard.dismiss();
    setIsLoading(true);

    // Clear the input field
    setTopic('');

    try {

      // Call your Supabase edge function
      const { data, error } = await supabase.functions.invoke('generate-thumbnail', {
        body: {
          prompt: promptToUse,
          style: style,
          subjectImageUrl: activeSubjectImageUrl, // Only include if actively selected
          referenceImageUrls: activeReferenceImageUrls, // Only include if actively selected
        },
      });


      if (error) {
        const errorMsg = error.message || 'Unknown error';

        // Provide helpful error messages based on common issues
        let userMessage = 'Failed to generate icon. ';
        if (errorMsg.includes('429') || errorMsg.includes('rate limit') || errorMsg.includes('quota')) {
          userMessage += 'The AI service is currently at capacity. Please wait a minute and try again.';
        } else if (errorMsg.includes('timeout') || errorMsg.includes('timed out')) {
          userMessage += 'Request timed out. The server might be busy. Please try again.';
        } else if (errorMsg.includes('503') || errorMsg.includes('unavailable')) {
          userMessage += 'Service temporarily unavailable. Please try again in a few moments.';
        } else {
          userMessage += errorMsg;
        }

        Alert.alert('Generation Error', userMessage);
        return;
      }

      if (data?.error) {
        Alert.alert('Error', data.error || 'Failed to generate icon');
        return;
      }

      // Handle 3 variations response
      if (data?.variation1 || data?.variation2 || data?.variation3) {
        const url1 = data.variation1?.imageUrl || data.variation1?.url;
        const url2 = data.variation2?.imageUrl || data.variation2?.url;
        const url3 = data.variation3?.imageUrl || data.variation3?.url;

        // Set the generated images
        setGeneratedImageUrl(url1 || '');
        setGeneratedImageUrl2(url2 || '');
        setGeneratedImageUrl3(url3 || '');

        // Automatically add all 3 variations to history (not favorited) - silently fail if not authenticated
        if (url1) {
          try {
            await addThumbnailToHistory(promptToUse, url1);
          } catch (historyError) {
            console.log('Skipping history save for url1 (not authenticated):', historyError);
          }
        }
        if (url2) {
          try {
            await addThumbnailToHistory(promptToUse, url2);
          } catch (historyError) {
            console.log('Skipping history save for url2 (not authenticated):', historyError);
          }
        }
        if (url3) {
          try {
            await addThumbnailToHistory(promptToUse, url3);
          } catch (historyError) {
            console.log('Skipping history save for url3 (not authenticated):', historyError);
          }
        }

        // Add to all generations list with all 3 variations
        const newGeneration = {
          id: Date.now().toString(),
          prompt: promptToUse,
          url1: url1,
          url2: url2,
          url3: url3,
          timestamp: Date.now(),
          customTitle: customTitleToUse, // Store custom title if set
        };
        setAllGenerations(prev => [newGeneration, ...prev]);
        setCustomTitle(null); // Reset custom title after use

        // Deduct 3 credits for successful generation (3 images = 3 credits)
        await deductCredit(3);

        // Refresh credits display immediately
        await refreshCredits();

        // Clear subject and reference images after successful generation
        if (activeSubjectImageUrl || activeReferenceImageUrls.length > 0) {
          setSubjectImage(null);
          setSubjectImageUrl(null);
          setReferenceImages([]);
          setReferenceImageUrls([]);
        }
      } else if (data?.imageUrl || data?.url) {
        // Fallback for single image (backwards compatibility)
        const imageUrl = data.imageUrl || data.url;
        setGeneratedImageUrl(imageUrl);
        setGeneratedImageUrl2('');
        setGeneratedImageUrl3('');

        try {
          await addThumbnailToHistory(promptToUse, imageUrl);
        } catch (historyError) {
          console.log('Skipping history save (not authenticated):', historyError);
        }

        const newGeneration = {
          id: Date.now().toString(),
          prompt: promptToUse,
          url1: imageUrl,
          url2: undefined,
          url3: undefined,
          timestamp: Date.now(),
          customTitle: customTitleToUse, // Store custom title if set
        };
        setAllGenerations(prev => [newGeneration, ...prev]);
        setCustomTitle(null); // Reset custom title after use

        await refreshCredits();

        if (activeSubjectImageUrl || activeReferenceImageUrls.length > 0) {
          setSubjectImage(null);
          setSubjectImageUrl(null);
          setReferenceImages([]);
          setReferenceImageUrls([]);
        }
      } else {
        Alert.alert('Error', 'No image was generated. Please try again.');
      }

    } catch (error) {
      Alert.alert('Error', 'Something went wrong. Please check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <ScrollView style={styles.scrollContainer} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Display all generated images or hero text */}
        {allGenerations.length > 0 || isLoading ? (
          <View style={styles.generationsContainer}>
            {/* Loading placeholder at the top when generating */}
            {isLoading && (
              <View style={styles.generationSection}>
                <Text style={styles.imageTitle}>
                  {customTitle || (lastPrompt ? getShortTitle(lastPrompt) : 'Generating...')}
                </Text>

                {/* First loading skeleton */}
                <View style={styles.loadingThumbnailContainer}>
                  <View style={styles.loadingSkeletonWrapper}>
                    <View style={styles.loadingBorderAnimated}>
                      <Svg width="100%" height="100%" viewBox="0 0 350 350" preserveAspectRatio="none">
                        <Defs>
                          <LinearGradient id="borderGrad1">
                            <Stop offset="0%" stopColor="transparent" stopOpacity="0" />
                            <Stop offset="30%" stopColor="#1e40af" stopOpacity="0.6" />
                            <Stop offset="50%" stopColor="#3b82f6" stopOpacity="1" />
                            <Stop offset="70%" stopColor="#60a5fa" stopOpacity="1" />
                            <Stop offset="85%" stopColor="#3b82f6" stopOpacity="0.6" />
                            <Stop offset="100%" stopColor="transparent" stopOpacity="0" />
                          </LinearGradient>
                        </Defs>
                        <Rect
                          x="2"
                          y="2"
                          width="346"
                          height="346"
                          rx="12"
                          stroke="#232932"
                          strokeWidth="1"
                          fill="none"
                        />
                        <AnimatedRect
                          x="2"
                          y="2"
                          width="346"
                          height="346"
                          rx="12"
                          stroke="url(#borderGrad1)"
                          strokeWidth="3"
                          fill="none"
                          strokeDasharray="200 800"
                          strokeDashoffset={borderOffset1}
                        />
                      </Svg>
                    </View>
                    <View style={styles.loadingSkeleton}>
                      <Animated.View style={[styles.loadingShimmer, { opacity: shimmer1Anim }]} />
                    </View>
                  </View>
                </View>

                {/* Second loading skeleton */}
                <View style={styles.loadingThumbnailContainer}>
                  <View style={styles.loadingSkeletonWrapper}>
                    <View style={styles.loadingBorderAnimated}>
                      <Svg width="100%" height="100%" viewBox="0 0 350 350" preserveAspectRatio="none">
                        <Defs>
                          <LinearGradient id="borderGrad2">
                            <Stop offset="0%" stopColor="transparent" stopOpacity="0" />
                            <Stop offset="30%" stopColor="#1e40af" stopOpacity="0.6" />
                            <Stop offset="50%" stopColor="#3b82f6" stopOpacity="1" />
                            <Stop offset="70%" stopColor="#60a5fa" stopOpacity="1" />
                            <Stop offset="85%" stopColor="#3b82f6" stopOpacity="0.6" />
                            <Stop offset="100%" stopColor="transparent" stopOpacity="0" />
                          </LinearGradient>
                        </Defs>
                        <Rect
                          x="2"
                          y="2"
                          width="346"
                          height="346"
                          rx="12"
                          stroke="#232932"
                          strokeWidth="1"
                          fill="none"
                        />
                        <AnimatedRect
                          x="2"
                          y="2"
                          width="346"
                          height="346"
                          rx="12"
                          stroke="url(#borderGrad2)"
                          strokeWidth="3"
                          fill="none"
                          strokeDasharray="200 800"
                          strokeDashoffset={borderOffset2}
                        />
                      </Svg>
                    </View>
                    <View style={styles.loadingSkeleton}>
                      <Animated.View style={[styles.loadingShimmer, { opacity: shimmer2Anim }]} />
                    </View>
                  </View>
                </View>

                {/* Third loading skeleton */}
                <View style={styles.loadingThumbnailContainer}>
                  <View style={styles.loadingSkeletonWrapper}>
                    <View style={styles.loadingBorderAnimated}>
                      <Svg width="100%" height="100%" viewBox="0 0 350 350" preserveAspectRatio="none">
                        <Defs>
                          <LinearGradient id="borderGrad3">
                            <Stop offset="0%" stopColor="transparent" stopOpacity="0" />
                            <Stop offset="30%" stopColor="#1e40af" stopOpacity="0.6" />
                            <Stop offset="50%" stopColor="#3b82f6" stopOpacity="1" />
                            <Stop offset="70%" stopColor="#60a5fa" stopOpacity="1" />
                            <Stop offset="85%" stopColor="#3b82f6" stopOpacity="0.6" />
                            <Stop offset="100%" stopColor="transparent" stopOpacity="0" />
                          </LinearGradient>
                        </Defs>
                        <Rect
                          x="2"
                          y="2"
                          width="346"
                          height="346"
                          rx="12"
                          stroke="#232932"
                          strokeWidth="1"
                          fill="none"
                        />
                        <AnimatedRect
                          x="2"
                          y="2"
                          width="346"
                          height="346"
                          rx="12"
                          stroke="url(#borderGrad3)"
                          strokeWidth="3"
                          fill="none"
                          strokeDasharray="200 800"
                          strokeDashoffset={borderOffset3}
                        />
                      </Svg>
                    </View>
                    <View style={styles.loadingSkeleton}>
                      <Animated.View style={[styles.loadingShimmer, { opacity: shimmer3Anim }]} />
                    </View>
                  </View>
                </View>

                {allGenerations.length > 0 && (
                  <View style={styles.generationSeparator} />
                )}
              </View>
            )}

            {/* All generations including current one */}
            {allGenerations.map((generation, index) => (
              <View key={generation.id} style={styles.generationSection}>
                {/* Title for each generation */}
                <Text style={styles.imageTitle}>
                  {generation.customTitle || getShortTitle(generation.prompt)}
                </Text>

                {/* First Generated Image */}
                {generation.url1 && (
                  <GeneratedThumbnail
                    key={`${generation.id}-1`}
                    imageUrl={generation.url1}
                    prompt={generation.prompt}
                    onEdit={() => openModal(generation.url1)}
                    style={styles}
                    textOverlay={generation.textOverlays?.url1}
                  />
                )}

                {/* Second Generated Image - Different Variation */}
                {generation.url2 && (
                  <GeneratedThumbnail
                    key={`${generation.id}-2`}
                    imageUrl={generation.url2}
                    prompt={generation.prompt}
                    onEdit={() => {
                      if (generation.url2) openModal(generation.url2);
                    }}
                    style={styles}
                    textOverlay={generation.textOverlays?.url2}
                  />
                )}

                {/* Third Generated Image - Different Variation */}
                {generation.url3 && (
                  <GeneratedThumbnail
                    key={`${generation.id}-3`}
                    imageUrl={generation.url3}
                    prompt={generation.prompt}
                    onEdit={() => {
                      if (generation.url3) openModal(generation.url3);
                    }}
                    style={styles}
                    textOverlay={generation.textOverlays?.url3}
                  />
                )}

                {/* Add separator between generations (except for the last one) */}
                {index < allGenerations.length - 1 && (
                  <View style={styles.generationSeparator} />
                )}
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.hero}>
            {!isLoading && (
              <View style={styles.heroIconContainer}>
                <View style={styles.pictureIcon}>
                  <View style={styles.pictureFrame}>
                    <View style={styles.pictureCorner1} />
                    <View style={styles.pictureCorner2} />
                    <View style={styles.pictureCorner3} />
                    <View style={styles.pictureCorner4} />
                    <View style={styles.picturePlus} />
                    <View style={styles.picturePlusVertical} />
                  </View>
                </View>
              </View>
            )}
            <Text style={styles.heroTitle}>
              {isLoading ? 'Generating your icon...' : 'Generate your icons.'}
            </Text>
            <Text style={styles.heroSubtitle}>
              {isLoading
                ? 'This may take a few moments'
                : 'Type a description or choose from the options below'
              }
            </Text>
          </View>
        )}

        {/* Bottom padding for fixed action cards and prompt bar */}
        <View style={{ height: 225 }} />
      </ScrollView>

      {/* Fixed Bottom Container with Action Cards and Prompt Bar */}
      <View style={[
        styles.fixedBottomContainer,
        {
          bottom: keyboardHeight > 0 ? keyboardHeight - insets.bottom - 41 : 0,
          paddingBottom: keyboardHeight > 0 ? 16 : Platform.select({ ios: 34, android: 16 }),
        }
      ]}>
        {/* Action Cards (h-scroll) - fixed at bottom */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.actionRow}
          style={styles.actionScrollView}
        >

          <TouchableOpacity
            style={[
              styles.actionCard,
              subjectImage && styles.actionCardWithReference
            ]}
            activeOpacity={0.85}
            onPress={() => setIsSubjectModalVisible(true)}
          >
            <View style={styles.actionIconWrap}><Text style={styles.actionIcon}>👤</Text></View>
            <Text style={styles.actionTitle}>Add a subject</Text>
            <Text style={styles.actionSubtitle}>Include an object</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.actionCard,
              referenceImages.length > 0 && styles.actionCardWithReference
            ]}
            activeOpacity={0.85}
            onPress={() => setIsReferenceModalVisible(true)}
          >
            <View style={styles.actionIconWrap}><Text style={styles.actionIcon}>✨</Text></View>
            <Text style={styles.actionTitle}>Add a Reference</Text>
            <Text style={styles.actionSubtitle}>Inspire the design</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* Suggestion Buttons */}
        <View style={styles.suggestionContainer}>
          <TouchableOpacity
            style={styles.suggestionButton}
            onPress={() => {
              setCustomTitle('Modern Finance Icon');
              handleGenerate(getRandomizedPresetPrompt('finance'), 'Modern Finance Icon');
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.suggestionText} numberOfLines={1}>Finance</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.suggestionButton}
            onPress={() => {
              setCustomTitle('Modern Fitness Icon');
              handleGenerate(getRandomizedPresetPrompt('fitness'), 'Modern Fitness Icon');
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.suggestionText} numberOfLines={1}>Fitness</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.suggestionButton}
            onPress={() => {
              setCustomTitle('Modern Photo Icon');
              handleGenerate(getRandomizedPresetPrompt('photo'), 'Modern Photo Icon');
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.suggestionText} numberOfLines={1}>Photo</Text>
          </TouchableOpacity>
        </View>

        {/* Prompt Bar */}
        <View style={styles.inputBar}>
          <TextInput
            style={styles.textInput}
            placeholder="Describe your icon idea"
            placeholderTextColor="#7b818a"
            value={topic}
            onChangeText={setTopic}
            multiline
            blurOnSubmit={true}
            returnKeyType="send"
            onKeyPress={({ nativeEvent }) => {
              if (nativeEvent.key === 'Enter') {
                if (topic.trim() && !isLoading) {
                  handleGenerate();
                }
              }
            }}
            onSubmitEditing={() => {
              if (topic.trim() && !isLoading) {
                handleGenerate();
              }
            }}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!topic || isLoading) && styles.sendBtnDisabled]}
            onPress={() => handleGenerate()}
            disabled={!topic || isLoading}
            activeOpacity={0.8}
          >
            {isLoading ? (
              <View style={styles.loadingDots}>
                <Animated.View style={[styles.dot, { transform: [{ translateY: dot1Anim }] }]} />
                <Animated.View style={[styles.dot, { transform: [{ translateY: dot2Anim }] }]} />
                <Animated.View style={[styles.dot, { transform: [{ translateY: dot3Anim }] }]} />
              </View>
            ) : (
              <Text style={styles.sendArrow}>↑</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Modal --- Editing Thumbnail Area */}
      <Modal
        visible={isModalVisible}
        animationType="none"
        presentationStyle="overFullScreen"
        supportedOrientations={['portrait']}
        onRequestClose={() => {}} // Prevent back button/gesture close
        hardwareAccelerated={true}
      >
        <GestureHandlerRootView style={{ flex: 1 }}>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={0}
          >
            <TouchableWithoutFeedback onPress={() => Keyboard.dismiss()}>
              <View style={[
                styles.modalContainer,
                {
                  overflow: 'hidden',
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0
                }
              ]}>
          {/* Header with X icon */}
          <View style={[styles.modalHeader, { paddingTop: 60, paddingBottom: 20 }]}>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={closeModal}
            >
              <Text style={styles.closeIcon}>✕</Text>
            </TouchableOpacity>
            <View style={styles.modalCreditsContainer}>
              <Text style={styles.modalCreditsText}>{credits.current}/{credits.max} images</Text>
            </View>
          </View>

          {/* Generated Image in the middle */}
          <View style={styles.centeredImageContainer}>
            <View style={styles.imageAndToolsGroup}>
              <View style={styles.imageWithDrawing}>
              <PinchGestureHandler
                onGestureEvent={onPinchGestureEvent}
                onHandlerStateChange={onPinchHandlerStateChange}
                enabled={selectedTool !== 'erase'}
              >
                <PanGestureHandler
                  onGestureEvent={onPanGestureEvent}
                  onHandlerStateChange={onPanHandlerStateChange}
                  enabled={selectedTool !== 'erase'}
                >
                  <Animated.View
                    style={[
                      styles.modalImageContainer,
                      {
                        transform: [
                          { scale: scaleValue.current },
                          { translateX: translateXValue.current },
                          { translateY: translateYValue.current },
                        ],
                      },
                    ]}
                    onLayout={(event) => {
                      const { width, height } = event.nativeEvent.layout;
                      setImageContainerDimensions({ width, height });
                    }}
                  >
                    <Image
                      source={{ uri: modalImageUrl }}
                      style={styles.modalImage as any}
                      resizeMode="cover"
                    />

                    {/* Regenerating Animation Overlay */}
                    {isModalGenerating && (
                      <View style={styles.modalLoadingOverlay}>
                        <View style={styles.modalLoadingTextContainer}>
                          <Text style={styles.modalLoadingText}>Regenerating...</Text>
                          <View style={styles.loadingDots}>
                            <Animated.View style={[styles.dot, { transform: [{ translateY: dot1Anim }] }]} />
                            <Animated.View style={[styles.dot, { transform: [{ translateY: dot2Anim }] }]} />
                            <Animated.View style={[styles.dot, { transform: [{ translateY: dot3Anim }] }]} />
                          </View>
                        </View>
                      </View>
                    )}

                    {/* Text overlay display - confirmed text that can be re-edited */}
                    {thumbnailEdits?.textOverlay && !textSticker && imageContainerDimensions.width > 0 && (
                      <TouchableOpacity
                        style={{
                          position: 'absolute',
                          left: thumbnailEdits.textOverlay.x * imageContainerDimensions.width,
                          top: thumbnailEdits.textOverlay.y * imageContainerDimensions.height,
                          transform: [
                            { scale: thumbnailEdits.textOverlay.scale },
                            { rotate: `${thumbnailEdits.textOverlay.rotation}deg` }
                          ],
                        }}
                        onPress={() => {
                          // Convert relative positions back to absolute for editing
                          const absoluteX = thumbnailEdits.textOverlay!.x * imageContainerDimensions.width;
                          const absoluteY = thumbnailEdits.textOverlay!.y * imageContainerDimensions.height;
                          
                          // Convert confirmed text back to editable textSticker
                          setSelectedTool('text');
                          setTextSticker({
                            text: thumbnailEdits.textOverlay!.text,
                            x: absoluteX,
                            y: absoluteY,
                            scale: thumbnailEdits.textOverlay!.scale,
                            rotation: thumbnailEdits.textOverlay!.rotation
                          });

                          // Initialize animated values with current absolute positions
                          textStickerBaseX.setOffset(absoluteX);
                          textStickerBaseY.setOffset(absoluteY);
                          textStickerBaseX.setValue(0);
                          textStickerBaseY.setValue(0);
                          textStickerBaseScale.setValue(thumbnailEdits.textOverlay!.scale);
                          textStickerBaseRotation.setValue(thumbnailEdits.textOverlay!.rotation);

                          // Reset deltas
                          textStickerPanDelta.setValue({ x: 0, y: 0 });
                          textStickerScaleDelta.setValue(1);
                          textStickerRotationDelta.setValue(0);

                          // Clear the confirmed overlay so it doesn't show behind the editable one
                          setThumbnailEdits(prev => ({
                            imageUrl: modalImageUrl,
                            textOverlay: undefined
                          }));
                        }}
                        onLongPress={() => {
                          // Long press to edit text content
                          Alert.prompt(
                            'Edit Text',
                            'Change your text:',
                            [
                              {
                                text: 'Cancel',
                                style: 'cancel'
                              },
                              {
                                text: 'Update',
                                onPress: (newText?: string) => {
                                  if (newText && newText.trim() && thumbnailEdits?.textOverlay) {
                                    setThumbnailEdits(prev => ({
                                      imageUrl: modalImageUrl,
                                      textOverlay: {
                                        ...prev!.textOverlay!,
                                        text: newText.trim()
                                      }
                                    }));
                                  }
                                }
                              }
                            ],
                            'plain-text',
                            thumbnailEdits?.textOverlay?.text
                          );
                        }}
                        activeOpacity={0.8}
                      >
                        <View
                          style={{
                            padding: 10,
                            // Remove background for clean look when confirmed
                            backgroundColor: 'transparent',
                            borderRadius: 8,
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
                            {thumbnailEdits.textOverlay.text}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    )}

                    {/* Erase mask overlay */}
                    {selectedTool === 'erase' && (
                      <View
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          right: 0,
                          bottom: 0,
                        }}
                        {...erasePanResponder.panHandlers}
                      >
                        <Svg style={{ width: '100%', height: '100%' }}>
                          {/* Draw completed mask */}
                          {eraseMask && (
                            <Path
                              d={eraseMask}
                              stroke="rgba(255, 0, 0, 0.6)"
                              strokeWidth="20"
                              fill="transparent"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          )}
                          {/* Draw current path being drawn */}
                          {currentErasePath && (
                            <Path
                              d={currentErasePath}
                              stroke="rgba(255, 0, 0, 0.6)"
                              strokeWidth="20"
                              fill="transparent"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          )}
                        </Svg>
                      </View>
                    )}

                    {/* Text sticker overlay - inside the transformed container */}
                    {textSticker && selectedTool === 'text' && (
                      <RotationGestureHandler
                        onGestureEvent={onTextRotationGestureEvent}
                        onHandlerStateChange={onTextRotationStateChange}
                      >
                        <PinchGestureHandler
                          onGestureEvent={onTextPinchGestureEvent}
                          onHandlerStateChange={onTextPinchStateChange}
                        >
                          <PanGestureHandler
                            onGestureEvent={onTextPanGestureEvent}
                            onHandlerStateChange={onTextPanStateChange}
                          >
                            <Animated.View
                              style={{
                                position: 'absolute',
                                left: Animated.add(textStickerBaseX, textStickerPanDelta.x),
                                top: Animated.add(textStickerBaseY, textStickerPanDelta.y),
                                transform: [
                                  { scale: Animated.multiply(textStickerBaseScale, textStickerScaleDelta) },
                                  { rotate: Animated.add(textStickerBaseRotation, textStickerRotationDelta).interpolate({
                                    inputRange: [0, 2 * Math.PI],
                                    outputRange: ['0rad', `${2 * Math.PI}rad`]
                                  }) }
                                ]
                              }}
                            >
                              <View
                                style={{
                                  padding: 10,
                                  backgroundColor: 'rgba(0, 0, 0, 0.5)',
                                  borderRadius: 8,
                                  borderWidth: 2,
                                  borderColor: '#FFD700',
                                  borderStyle: 'dashed'
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
                                  {textSticker.text}
                                </Text>
                              </View>
                            </Animated.View>
                          </PanGestureHandler>
                        </PinchGestureHandler>
                      </RotationGestureHandler>
                    )}

                  </Animated.View>
                </PanGestureHandler>
              </PinchGestureHandler>

            </View>

            {/* Check button for confirming erase selection */}
            {showEraseConfirm && selectedTool === 'erase' && !isModalGenerating && (
              <TouchableOpacity
                style={{
                  position: 'absolute',
                  bottom: 100,
                  alignSelf: 'center',
                  backgroundColor: '#4CAF50',
                  width: 60,
                  height: 60,
                  borderRadius: 30,
                  justifyContent: 'center',
                  alignItems: 'center',
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.3,
                  shadowRadius: 4,
                  elevation: 5,
                }}
                onPress={async () => {
                  setIsModalGenerating(true);

                  try {
                    // Find the current generation
                    const currentGeneration = allGenerations.find(gen =>
                      gen.url1 === modalImageUrl || gen.url2 === modalImageUrl || gen.url3 === modalImageUrl
                    );

                    if (!currentGeneration) {
                      Alert.alert('Error', 'Could not find original prompt');
                      setIsModalGenerating(false);
                      return;
                    }

                    // Create a simple, direct prompt focusing only on removal
                    const inpaintPrompt = `Remove ONLY the areas marked with RED overlay from this image. The red overlay shows exactly what to remove. Keep everything else identical. Fill the removed area naturally to match the surrounding background. Do NOT remove any unmarked areas.`;

                    let attempts = 0;
                    const maxAttempts = 2;
                    let success = false;
                    let finalImageUrl = '';

                    // Retry logic to ensure object removal
                    while (attempts < maxAttempts && !success) {
                      attempts++;

                      // Call the generate function
                      const { data, error } = await supabase.functions.invoke('generate-thumbnail', {
                        body: {
                          prompt: inpaintPrompt,
                          baseImageUrl: modalImageUrl,
                          adjustmentMode: true,
                          eraseMask: eraseMask, // Send the mask path to backend
                          seed: Date.now() + attempts, // Different seed for each attempt
                        }
                      });

                      if (error) {
                        if (attempts >= maxAttempts) throw error;
                        continue;
                      }

                      if (data?.imageUrl) {
                        finalImageUrl = data.imageUrl;
                        success = true;
                        break;
                      }
                    }

                    if (success && finalImageUrl) {
                      // Update the modal image
                      setModalImageUrl(finalImageUrl);

                      // Update the generation in the list
                      setAllGenerations(prev => prev.map(gen => {
                        if (gen.id === currentGeneration.id) {
                          if (gen.url1 === modalImageUrl) {
                            return { ...gen, url1: finalImageUrl };
                          } else if (gen.url2 === modalImageUrl) {
                            return { ...gen, url2: finalImageUrl };
                          }
                        }
                        return gen;
                      }));

                      // Reset erase state
                      setSelectedTool(null);
                      setEraseMask('');
                      setCurrentErasePath('');
                      erasePathRef.current = '';
                      setShowEraseConfirm(false);

                      Alert.alert('Success', 'Object removed successfully!');
                    } else {
                      throw new Error('Failed to generate image after multiple attempts');
                    }
                  } catch (error) {
                    Alert.alert('Error', 'Failed to remove object. Please try again.');
                    setShowEraseConfirm(true);
                  } finally {
                    setIsModalGenerating(false);
                  }
                }}
              >
                <Text style={{ fontSize: 30, color: '#ffffff' }}>✓</Text>
              </TouchableOpacity>
            )}

            {/* Loading indicator for erase processing */}
            {isModalGenerating && selectedTool === 'erase' && (
              <View
                style={{
                  position: 'absolute',
                  bottom: 100,
                  alignSelf: 'center',
                  backgroundColor: 'rgba(0, 0, 0, 0.7)',
                  paddingHorizontal: 20,
                  paddingVertical: 15,
                  borderRadius: 20,
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <View style={styles.loadingDots}>
                  <Animated.View style={[styles.dot, { transform: [{ translateY: dot1Anim }] }]} />
                  <Animated.View style={[styles.dot, { transform: [{ translateY: dot2Anim }] }]} />
                  <Animated.View style={[styles.dot, { transform: [{ translateY: dot3Anim }] }]} />
                </View>
                <Text style={{ color: '#ffffff', marginTop: 10, fontSize: 12 }}>
                  Removing object...
                </Text>
              </View>
            )}

            {/* Edit Tools */}
            <View style={styles.editTools}>
              {selectedTool === 'text' && textSticker ? (
                <>
                  {/* Text editing tools: -, Edit, +, ✓ */}
                  <TouchableOpacity
                    style={styles.editToolIcon}
                    onPress={() => {
                      if (textSticker) {
                        const newScale = Math.max(0.5, textSticker.scale - 0.1);
                        setTextSticker(prev => prev ? { ...prev, scale: newScale } : null);
                        textStickerBaseScale.setValue(newScale);
                      }
                    }}
                  >
                    <Text style={styles.editToolText}>−</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.editToolIcon}
                    onPress={() => {
                      // Edit text content
                      Alert.prompt(
                        'Edit Text',
                        'Change your text:',
                        [
                          {
                            text: 'Cancel',
                            style: 'cancel'
                          },
                          {
                            text: 'Update',
                            onPress: (newText?: string) => {
                              if (newText && newText.trim() && textSticker) {
                                setTextSticker(prev => prev ? {
                                  ...prev,
                                  text: newText.trim()
                                } : null);
                              }
                            }
                          }
                        ],
                        'plain-text',
                        textSticker.text
                      );
                    }}
                  >
                    <Text style={{ fontSize: 14, color: '#ffffff', fontWeight: '600' }}>Aa</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity
                    style={styles.editToolIcon}
                    onPress={() => {
                      if (textSticker) {
                        const newScale = Math.min(3, textSticker.scale + 0.1);
                        setTextSticker(prev => prev ? { ...prev, scale: newScale } : null);
                        textStickerBaseScale.setValue(newScale);
                      }
                    }}
                  >
                    <Text style={styles.editToolText}>+</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity
                    style={styles.editToolIcon}
                    onPress={async () => {
                      if (!textSticker || imageContainerDimensions.width === 0 || imageContainerDimensions.height === 0) return;

                      // Check credits before applying text
                      const creditsCheck = await getCredits();
                      if (creditsCheck.current <= 0) {
                        Alert.alert(
                          'No Credits Remaining',
                          'You have used all your credits. Your credits will reset based on your subscription plan.',
                          [{ text: 'OK' }]
                        );
                        return;
                      }

                      try {
                        setIsModalGenerating(true);

                        // Convert absolute positions to relative percentages for consistent scaling
                        const relativeX = textSticker.x / imageContainerDimensions.width;
                        const relativeY = textSticker.y / imageContainerDimensions.height;

                        // Store the text overlay information with relative positioning
                        const textOverlay = {
                          text: textSticker.text,
                          x: relativeX, // Now storing as percentage (0.0 to 1.0)
                          y: relativeY, // Now storing as percentage (0.0 to 1.0)
                          scale: textSticker.scale,
                          rotation: textSticker.rotation
                        };

                        // Update thumbnail edits to include text overlay
                        setThumbnailEdits(prev => ({
                          imageUrl: modalImageUrl,
                          textOverlay: textOverlay
                        }));

                        // Update the allGenerations state to include text overlay
                        setAllGenerations(prev => prev.map(gen => {
                          if (gen.url1 === modalImageUrl) {
                            return {
                              ...gen,
                              textOverlays: {
                                ...gen.textOverlays,
                                url1: textOverlay
                              }
                            };
                          } else if (gen.url2 === modalImageUrl) {
                            return {
                              ...gen,
                              textOverlays: {
                                ...gen.textOverlays,
                                url2: textOverlay
                              }
                            };
                          } else if (gen.url3 === modalImageUrl) {
                            return {
                              ...gen,
                              textOverlays: {
                                ...gen.textOverlays,
                                url3: textOverlay
                              }
                            };
                          }
                          return gen;
                        }));

                        // Find current generation to get prompt for saving to history
                        const currentGeneration = allGenerations.find(gen =>
                          gen.url1 === originalModalImageUrl || gen.url2 === originalModalImageUrl || gen.url3 === originalModalImageUrl ||
                          gen.url1 === modalImageUrl || gen.url2 === modalImageUrl || gen.url3 === modalImageUrl
                        );

                        if (currentGeneration) {
                          // Use originalModalImageUrl (the remote URL) for syncing
                          const urlToSave = originalModalImageUrl || modalImageUrl;
                          console.log('[ADD TO HISTORY] Adding thumbnail with URL:', urlToSave.substring(0, 60));
                          // Save to history with text overlay
                          try {
                            await addThumbnailToHistory(currentGeneration.prompt, urlToSave, {
                              textOverlay: textOverlay
                            });
                          } catch (historyError) {
                            console.log('Skipping history save (not authenticated):', historyError);
                          }
                        }

                        // Deduct 1 credit for text overlay application (count as image generation)
                        await deductCredit(1);

                        // Refresh credits display immediately
                        await refreshCredits();

                        // Clear text sticker and deselect tool
                        setTextSticker(null);
                        setSelectedTool(null);
                        textStickerPanDelta.setValue({ x: 0, y: 0 });
                        textStickerScaleDelta.setValue(1);
                        textStickerRotationDelta.setValue(0);
                        textStickerBaseX.setOffset(0);
                        textStickerBaseY.setOffset(0);
                        textStickerBaseX.setValue(0);
                        textStickerBaseY.setValue(0);
                        textStickerBaseScale.setValue(1);
                        textStickerBaseRotation.setValue(0);
                      } catch (error) {
                        Alert.alert('Error', 'Failed to add text. Please try again.');
                      } finally {
                        setIsModalGenerating(false);
                      }
                    }}
                  >
                    <Text style={styles.editToolText}>✓</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  {/* Normal editing tools: text, save */}
                  {/* ERASE TOOL COMMENTED OUT - uncomment when ready
                  <TouchableOpacity
                    style={[
                      styles.editToolIcon,
                      selectedTool === 'erase' && styles.editToolIconSelected
                    ]}
                    onPress={() => {
                      if (selectedTool === 'erase') {
                        setSelectedTool(null);
                        setEraseMask('');
                        setCurrentErasePath('');
                        erasePathRef.current = '';
                        setShowEraseConfirm(false);
                      } else {
                        setSelectedTool('erase');
                      }
                    }}
                  >
                    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                      <Path
                        d="M4.5 12.5l7-7a4.95 4.95 0 1 1 7 7l-7 7a4.95 4.95 0 1 1-7-7z"
                        stroke="#ffffff"
                        strokeWidth="2"
                        fill="none"
                      />
                      <Path d="M8.5 8.5h1v1h-1zm5 0h1v1h-1zm-5 5h1v1h-1zm5 0h1v1h-1z" fill="#ffffff" />
                    </Svg>
                  </TouchableOpacity>
                  */}
                  <TouchableOpacity
                    style={[
                      styles.editToolIcon,
                      selectedTool === 'text' && styles.editToolIconSelected
                    ]}
                    onPress={() => {
                      if (selectedTool === 'text' && textSticker) {
                        // Deselect text tool
                        setSelectedTool(null);
                        setTextSticker(null);
                        textStickerPanDelta.setValue({ x: 0, y: 0 });
                        textStickerScaleDelta.setValue(1);
                        textStickerRotationDelta.setValue(0);
                        textStickerBaseX.setOffset(0);
                        textStickerBaseY.setOffset(0);
                        textStickerBaseX.setValue(0);
                        textStickerBaseY.setValue(0);
                        textStickerBaseScale.setValue(1);
                        textStickerBaseRotation.setValue(0);
                      } else {
                        // Show text input prompt
                        Alert.prompt(
                          'Add Text',
                          'Enter your text:',
                          [
                            {
                              text: 'Cancel',
                              style: 'cancel'
                            },
                            {
                              text: 'Add',
                              onPress: (text?: string) => {
                                if (text && text.trim()) {
                                  setSelectedTool('text');
                                  // Center text in image container
                                  const centerX = imageContainerDimensions.width > 0
                                    ? imageContainerDimensions.width / 2 - 100 // Approximate half text width
                                    : 0;
                                  const centerY = imageContainerDimensions.height > 0
                                    ? imageContainerDimensions.height / 2 - 30 // Approximate half text height
                                    : 0;

                                  setTextSticker({
                                    text: text.trim(),
                                    x: centerX,
                                    y: centerY,
                                    scale: 1,
                                    rotation: 0
                                  });

                                  // Initialize with offset instead of value
                                  textStickerBaseX.setOffset(centerX);
                                  textStickerBaseY.setOffset(centerY);
                                  textStickerBaseX.setValue(0);
                                  textStickerBaseY.setValue(0);
                                  textStickerBaseScale.setValue(1);
                                  textStickerBaseRotation.setValue(0);

                                  // Reset deltas
                                  textStickerPanDelta.setValue({ x: 0, y: 0 });
                                  textStickerScaleDelta.setValue(1);
                                  textStickerRotationDelta.setValue(0);
                                }
                              }
                            }
                          ],
                          'plain-text'
                        );
                      }
                    }}
                  >
                    <Text style={{ fontSize: 16, color: '#ffffff', fontWeight: '600' }}>Aa</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.editToolIcon,
                      selectedTool === 'save' && styles.editToolIconSelected
                    ]}
                    onPress={async () => {
                      try {
                        // Check if there's an active text sticker that hasn't been confirmed yet
                        if (textSticker && selectedTool === 'text') {
                          Alert.alert(
                            'Unsaved Text',
                            'You have text that hasn\'t been confirmed yet. Please click the checkmark (✓) to apply the text before saving.',
                            [{ text: 'OK', style: 'default' }]
                          );
                          return;
                        }

                        // Find the generation that matches the current modal image
                        // First try to match with originalModalImageUrl, then fall back to modalImageUrl
                        const currentGeneration = allGenerations.find(gen =>
                          gen.url1 === originalModalImageUrl || gen.url2 === originalModalImageUrl || gen.url3 === originalModalImageUrl ||
                          gen.url1 === modalImageUrl || gen.url2 === modalImageUrl || gen.url3 === modalImageUrl
                        );

                        if (currentGeneration) {
                          const editsToSave = thumbnailEdits?.textOverlay ? {
                            textOverlay: thumbnailEdits.textOverlay
                          } : null;

                          // Use originalModalImageUrl (the remote URL) for syncing, not the edited local path
                          // This ensures cross-device sync works correctly
                          const urlToSave = originalModalImageUrl || modalImageUrl;
                          console.log('[SAVE] Saving icon with URL:', urlToSave.substring(0, 60));
                          await saveThumbnail(currentGeneration.prompt, urlToSave, editsToSave);
                          Alert.alert('Saved!', 'Icon saved to your history');
                        } else {
                          Alert.alert('Error', 'Could not find icon to save');
                        }
                      } catch (error) {
                        Alert.alert('Error', 'Failed to save icon');
                      }
                    }}
                  >
                    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                      <Path
                        d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
                        stroke="#ffffff"
                        strokeWidth="2"
                        fill="none"
                      />
                    </Svg>
                  </TouchableOpacity>
                </>
              )}
            </View>
            </View>
          </View>

          {/* Prompt Bar at the bottom */}
          <TouchableWithoutFeedback onPress={(e) => e.stopPropagation()}>
            <View style={[
              styles.modalPromptContainer,
              {
                paddingBottom: modalKeyboardHeight > 0
                  ? Math.max(
                      modalKeyboardHeight - insets.bottom + 60,
                      Platform.select({ ios: 60, android: 70 }) ?? 60
                    )
                  : Platform.select({ ios: 34, android: 16 })
              }
            ]}>
              {/* Edit Suggestion Buttons */}
              <View style={styles.modalSuggestionContainer}>
                <TouchableOpacity
                  style={styles.modalSuggestionButton}
                  onPress={() => setModalPrompt('Change the')}
                  activeOpacity={0.7}
                >
                  <Text style={styles.modalSuggestionText}>Change the...</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.modalSuggestionButton}
                  onPress={() => setModalPrompt('Remove the')}
                  activeOpacity={0.7}
                >
                  <Text style={styles.modalSuggestionText}>Remove the...</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.modalSuggestionButton}
                  onPress={() => setModalPrompt('Add a')}
                  activeOpacity={0.7}
                >
                  <Text style={styles.modalSuggestionText}>Add a...</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.modalInputBar}>
                <TextInput
                  style={styles.textInput}
                  placeholder="Edit your icon prompt"
                  placeholderTextColor="#7b818a"
                  value={modalPrompt}
                  onChangeText={setModalPrompt}
                  multiline
                  returnKeyType="send"
                  blurOnSubmit={true}
                  onKeyPress={({ nativeEvent }) => {
                    if (nativeEvent.key === 'Enter') {
                      if (modalPrompt.trim() && !isModalGenerating) {
                        handleModalGenerate();
                      }
                    }
                  }}
                  onSubmitEditing={() => {
                    if (modalPrompt.trim() && !isModalGenerating) {
                      handleModalGenerate();
                    }
                  }}
                />
                <TouchableOpacity
                  style={[styles.sendBtn, (!modalPrompt || isModalGenerating) && styles.sendBtnDisabled]}
                  disabled={!modalPrompt || isModalGenerating}
                  onPress={handleModalGenerate}
                  activeOpacity={0.8}
                >
                  {isModalGenerating ? (
                    <View style={styles.loadingDots}>
                      <Animated.View style={[styles.dot, { transform: [{ translateY: dot1Anim }] }]} />
                      <Animated.View style={[styles.dot, { transform: [{ translateY: dot2Anim }] }]} />
                      <Animated.View style={[styles.dot, { transform: [{ translateY: dot3Anim }] }]} />
                    </View>
                  ) : (
                    <Text style={styles.sendArrow}>↑</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
          </TouchableWithoutFeedback>
          </KeyboardAvoidingView>
        </GestureHandlerRootView>
      </Modal>

      {/* Subject Modal */}
      <Modal
        visible={isSubjectModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsSubjectModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Add a Subject</Text>
            <Text style={styles.modalSubtitle}>Upload an image of a person or object to include</Text>

            {subjectImage ? (
              <View style={styles.imagePreviewContainer}>
                <Image source={{ uri: subjectImage as string }} style={styles.imagePreview as any} />
                <TouchableOpacity
                  style={styles.removeImageButton}
                  onPress={() => {
                    setSubjectImage(null);
                    setSubjectImageUrl(null); // Clear URL when image is removed
                  }}
                >
                  <Text style={styles.removeImageText}>✕</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.uploadButton}
                onPress={async () => {
                  try {
                    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
                    if (status !== 'granted') {
                      Alert.alert('Permission Required', 'Please grant photo library access to upload images');
                      return;
                    }

                    const result = await ImagePicker.launchImageLibraryAsync({
                      mediaTypes: ImagePicker.MediaTypeOptions.Images,
                      allowsEditing: true,
                      aspect: [1, 1],
                      quality: 0.8,
                    });

                    if (!result.canceled && result.assets[0]) {
                      setSubjectImage(result.assets[0].uri);
                    }
                  } catch (error) {
                    Alert.alert('Error', 'Failed to select image');
                  }
                }}
              >
                <Text style={styles.uploadIcon}>📷</Text>
                <Text style={styles.uploadText}>Upload Subject Image</Text>
              </TouchableOpacity>
            )}

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => {
                  setIsSubjectModalVisible(false);
                  // Only clear if user was in the process of selecting (modal was opened without existing image)
                }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalAddButton, !subjectImage && styles.modalAddButtonDisabled]}
                disabled={!subjectImage}
                onPress={async () => {
                  if (subjectImage) {
                    try {
                      // Upload image to Supabase Storage
                      const uploadedUrl = await uploadImageToStorage(subjectImage, 'subject');

                      if (uploadedUrl) {
                        setSubjectImageUrl(uploadedUrl);
                        Alert.alert('Subject Added', 'Subject image uploaded and ready for icon generation');
                        setIsSubjectModalVisible(false);
                      } else {
                        Alert.alert('Upload Failed', 'Failed to upload subject image. Please try again.');
                      }
                    } catch (error) {
                      Alert.alert('Upload Error', 'Something went wrong uploading the subject image.');
                    }
                  }
                }}
              >
                <Text style={styles.modalAddText}>Add Subject</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Reference Modal */}
      <Modal
        visible={isReferenceModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsReferenceModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Add a Reference</Text>
            <Text style={styles.modalSubtitle}>Upload up to 3 reference images to inspire the design</Text>

            {/* Reference Images Grid */}
            <View style={styles.referenceImagesContainer}>
              {referenceImages.map((imageUri, index) => (
                <View key={index} style={styles.referenceImageItem}>
                  <Image source={{ uri: imageUri }} style={styles.referenceImagePreview as any} />
                  <TouchableOpacity
                    style={styles.removeReferenceButton}
                    onPress={() => {
                      setReferenceImages(prev => prev.filter((_, i) => i !== index));
                      setReferenceImageUrls(prev => prev.filter((_, i) => i !== index)); // Clear corresponding URL
                    }}
                  >
                    <Text style={styles.removeImageText}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}

              {/* Add more images button */}
              {referenceImages.length < 3 && (
                <TouchableOpacity
                  style={styles.addReferenceButton}
                  onPress={async () => {
                    try {
                      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
                      if (status !== 'granted') {
                        Alert.alert('Permission Required', 'Please grant photo library access to upload images');
                        return;
                      }

                      const result = await ImagePicker.launchImageLibraryAsync({
                        mediaTypes: ImagePicker.MediaTypeOptions.Images,
                        allowsEditing: true,
                        aspect: [4, 3],
                        quality: 0.8,
                      });

                      if (!result.canceled && result.assets[0]) {
                        setReferenceImages(prev => [...prev, result.assets[0].uri]);
                      }
                    } catch (error) {
                      Alert.alert('Error', 'Failed to select image');
                    }
                  }}
                >
                  <Text style={styles.addReferenceIcon}>+</Text>
                  <Text style={styles.addReferenceText}>
                    {referenceImages.length === 0 ? 'Add Reference' : `Add ${3 - referenceImages.length} More`}
                  </Text>
                </TouchableOpacity>
              )}
            </View>


            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => {
                  setIsReferenceModalVisible(false);
                  // Only clear if user was in the process of selecting (modal was opened without existing image)
                }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalAddButton, referenceImages.length === 0 && styles.modalAddButtonDisabled]}
                disabled={referenceImages.length === 0}
                onPress={async () => {
                  if (referenceImages.length > 0) {
                    try {
                      // Upload all reference images
                      const uploadPromises = referenceImages.map((imageUri, index) =>
                        uploadImageToStorage(imageUri, `reference_${index}`)
                      );

                      const uploadedUrls = await Promise.all(uploadPromises);
                      const validUrls = uploadedUrls.filter(url => url !== null) as string[];

                      if (validUrls.length === referenceImages.length) {
                        setReferenceImageUrls(validUrls);
                        Alert.alert(
                          'References Added',
                          `${validUrls.length} reference image${validUrls.length > 1 ? 's' : ''} uploaded and ready for icon generation`
                        );
                        setIsReferenceModalVisible(false);
                      } else {
                        Alert.alert('Upload Failed', 'Some reference images failed to upload. Please try again.');
                      }
                    } catch (error) {
                      Alert.alert('Upload Error', 'Something went wrong uploading the reference images.');
                    }
                  }
                }}
              >
                <Text style={styles.modalAddText}>
                  {referenceImages.length > 0 ? `Add ${referenceImages.length} Reference${referenceImages.length > 1 ? 's' : ''}` : 'Add References'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const BG = '#0b0f14';
const CARD = '#151a21';
const BORDER = '#232932';
const TEXT = '#e7ebf0';
const MUTED = '#8a9099';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  scrollContainer: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    paddingTop: Platform.select({ ios: 12, android: 16 }),
    paddingHorizontal: 18,
    paddingBottom: 120,
  },
  fixedBottomContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: BG,
    paddingBottom: 8,
    paddingTop: 8,
  },
  actionScrollView: {
    paddingHorizontal: 18,
    marginBottom: 8,
  },
  hero: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  heroIconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  pictureIcon: {
    width: 250,
    height: 150,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pictureFrame: {
    width: '100%',
    height: '100%',
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pictureCorner1: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 16,
    height: 16,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderColor: MUTED,
  },
  pictureCorner2: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 16,
    height: 16,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderColor: MUTED,
  },
  pictureCorner3: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: 16,
    height: 16,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderColor: MUTED,
  },
  pictureCorner4: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 16,
    height: 16,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderColor: MUTED,
  },
  picturePlus: {
    width: 24,
    height: 3,
    backgroundColor: TEXT,
    borderRadius: 1.5,
  },
  picturePlusVertical: {
    position: 'absolute',
    width: 3,
    height: 24,
    backgroundColor: TEXT,
    borderRadius: 1.5,
  },
  heroTitle: {
    color: TEXT,
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
  heroSubtitle: {
    color: MUTED,
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  actionRow: {
    paddingVertical: 14,
    gap: 12,
  },
  actionCard: {
    width: 220,
    backgroundColor: CARD,
    borderColor: BORDER,
    borderWidth: 1,
    padding: 14,
    borderRadius: 16,
    marginRight: 12,
  },
  actionCardWithReference: {
    borderColor: '#fbbf24',
    borderWidth: 2,
  },
  actionIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#1c222b',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  actionIcon: {
    fontSize: 20,
  },
  actionTitle: {
    color: TEXT,
    fontWeight: '700',
    fontSize: 16,
  },
  actionSubtitle: {
    color: MUTED,
    fontSize: 12,
    marginTop: 6,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD,
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 28,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginHorizontal: 18,
  },
  paperclip: {
    fontSize: 16,
    marginRight: 8,
    color: MUTED,
    textAlignVertical: 'center',
  },
  textInput: {
    flex: 1,
    color: TEXT,
    fontSize: 15,
    textAlign: 'left',
    textAlignVertical: 'center',
    paddingLeft: 8,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#007AFF',
    marginLeft: 8,
  },
  sendBtnDisabled: {
    opacity: 0.5,
  },
  sendArrow: {
    color: TEXT,
    fontSize: 16,
    fontWeight: '800',
  },
  loadingDots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
  },
  imageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  generationsContainer: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  generationSection: {
    marginBottom: 20,
  },
  generationSeparator: {
    height: 1,
    backgroundColor: BORDER,
    marginVertical: 30,
  },
  imageTitle: {
    color: TEXT,
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'left',
    alignSelf: 'flex-start',
  },
  generatedImage: {
    width: '100%',
    aspectRatio: 1, // Square 1:1 ratio for icons
    borderRadius: 12,
    backgroundColor: CARD,
  },
  generateNewBtn: {
    backgroundColor: '#2a3038',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
  },
  generateNewText: {
    color: TEXT,
    fontSize: 16,
    fontWeight: '600',
  },
  imageWrapper: {
    position: 'relative',
    width: '100%',
    marginBottom: 20,
  },
  loadingThumbnailContainer: {
    width: '100%',
    marginBottom: 20,
    position: 'relative',
  },
  loadingSkeletonWrapper: {
    position: 'relative',
    width: '100%',
    aspectRatio: 1, // Square 1:1 ratio for icons
  },
  loadingBorderAnimated: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
  },
  loadingSkeleton: {
    width: '100%',
    aspectRatio: 1, // Square 1:1 ratio for icons
    borderRadius: 12,
    backgroundColor: CARD,
    overflow: 'hidden',
    position: 'relative',
  },
  loadingShimmer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(139, 146, 155, 0.1)',
  },
  modalLoadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(11, 15, 20, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  modalLoadingTextContainer: {
    marginTop: 20,
    alignItems: 'center',
  },
  modalLoadingText: {
    color: TEXT,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  downloadIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  downloadArrow: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  imageActions: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    flexDirection: 'row',
    gap: 8,
  },
  editButton: {
    backgroundColor: '#000000',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  editText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  saveIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  saveArrow: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: BG,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#2a3038',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeIcon: {
    color: TEXT,
    fontSize: 18,
    fontWeight: 'bold',
  },
  modalCreditsContainer: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(0, 122, 255, 0.5)',
    backgroundColor: 'transparent',
  },
  modalCreditsText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  centeredImageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  imageAndToolsGroup: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  modalImage: {
    width: '100%',
    aspectRatio: 1, // Square 1:1 ratio for icons
    borderRadius: 12,
    backgroundColor: CARD,
  },
  modalImageContainer: {
    width: '100%',
    aspectRatio: 1, // Square 1:1 ratio for icons
  },
  modalPromptContainer: {
    paddingHorizontal: 18,
    paddingBottom: Platform.select({ ios: 34, android: 16 }),
    paddingTop: 16,
  },
  modalInputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD,
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 28,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  modalSuggestionContainer: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  modalSuggestionButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#2a2e35',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSuggestionText: {
    color: MUTED,
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
  editTools: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
    paddingHorizontal: 20,
    gap: 12,
    width: '100%',
  },
  editToolIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  editToolText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  editToolIconSelected: {
    borderWidth: 3,
    borderColor: '#FFD700', // Yellow border when selected
  },
  imageWithDrawing: {
    position: 'relative',
    width: '100%',
    aspectRatio: 1, // Square 1:1 ratio for icons
  },
  drawingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
  },
  persistentDrawingsOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 5,
  },
  textElement: {
    position: 'absolute',
    alignItems: 'center',
  },
  textElementText: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
    color: '#ffffff',
  },
  textPlaceholder: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -50 }, { translateY: -15 }],
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  textPlaceholderText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    borderColor: BORDER,
    borderWidth: 1,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: TEXT,
    marginBottom: 8,
    textAlign: 'center',
  },
  modalSubtitle: {
    fontSize: 14,
    color: MUTED,
    marginBottom: 20,
    textAlign: 'center',
    lineHeight: 20,
  },
  uploadButton: {
    backgroundColor: BG,
    borderColor: BORDER,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    minHeight: 120,
  },
  uploadIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  uploadText: {
    color: TEXT,
    fontSize: 16,
    fontWeight: '500',
  },
  imagePreviewContainer: {
    position: 'relative',
    marginBottom: 24,
    borderRadius: 12,
    overflow: 'hidden',
  },
  imagePreview: {
    width: '100%',
    height: 150,
    borderRadius: 12,
  },
  removeImageButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeImageText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  changeImageButton: {
    backgroundColor: BG,
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 24,
  },
  changeImageText: {
    color: TEXT,
    fontSize: 14,
    fontWeight: '500',
  },
  referenceImagesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  },
  referenceImageItem: {
    position: 'relative',
    width: 100,
    height: 80,
    borderRadius: 8,
    overflow: 'hidden',
  },
  referenceImagePreview: {
    width: '100%',
    height: '100%',
  },
  removeReferenceButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addReferenceButton: {
    width: 100,
    height: 80,
    borderWidth: 2,
    borderColor: BORDER,
    borderStyle: 'dashed',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BG,
  },
  addReferenceIcon: {
    fontSize: 24,
    color: TEXT,
    marginBottom: 4,
  },
  addReferenceText: {
    fontSize: 10,
    color: MUTED,
    textAlign: 'center',
    fontWeight: '500',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalCancelButton: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: BG,
    borderColor: BORDER,
    borderWidth: 1,
    alignItems: 'center',
  },
  modalCancelText: {
    color: MUTED,
    fontSize: 16,
    fontWeight: '600',
  },
  modalAddButton: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: '#2563eb',
    alignItems: 'center',
  },
  modalAddButtonDisabled: {
    backgroundColor: '#374151',
  },
  modalAddText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  suggestionContainer: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 26,
    marginBottom: 8,
  },
  suggestionButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 8,
    backgroundColor: '#2a2e35',
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0, // Allow flex to shrink below content width
  },
  suggestionText: {
    color: MUTED,
    fontSize: Platform.select({
      android: 12,
      ios: 13,
      default: 13,
    }),
    fontWeight: '500',
    textAlign: 'center',
  },
});