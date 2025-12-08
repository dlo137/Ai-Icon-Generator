// deno run --allow-env --allow-net --allow-read
import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// Square 1024x1024 for icons
const WIDTH = 1024;
const HEIGHT = 1024;

// Gemini 2.5 Flash with native image generation (may be free tier compatible)
const IMAGES_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-exp:generateContent";

// Gemini 2.5 Flash Image Preview for direct image generation from images+prompt
const IMAGE_PREVIEW_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent";

type GenerateBody = {
  prompt: string;
  style?: string;
  seed?: number;
  subjectImageUrl?: string;
  referenceImageUrls?: string[];
  baseImageUrl?: string;
  adjustmentMode?: boolean;
  allowTextFallback?: boolean;
  eraseMask?: string;
};

function b64ToUint8(base64: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function resizeImageTo1024x1024(imageBytes: Uint8Array): Promise<Uint8Array> {
  console.log('🔄 Resizing image to 1024x1024...');
  try {
    // Decode the image
    const image = await Image.decode(imageBytes);
    console.log(`📐 Original image size: ${image.width}x${image.height}`);

    // If already square and correct size, return as-is
    if (image.width === WIDTH && image.height === HEIGHT) {
      console.log('✅ Image already 1024x1024, no resize needed');
      return imageBytes;
    }

    let processedImage = image;

    // If not square, crop to square first (center crop)
    if (image.width !== image.height) {
      const minDimension = Math.min(image.width, image.height);
      const x = Math.floor((image.width - minDimension) / 2);
      const y = Math.floor((image.height - minDimension) / 2);

      console.log(`✂️  Cropping to square: ${minDimension}x${minDimension} from position (${x}, ${y})`);
      processedImage = image.crop(x, y, minDimension, minDimension);
      console.log(`✅ Cropped to: ${processedImage.width}x${processedImage.height}`);
    }

    // Now resize to 1024x1024 (both dimensions specified, no aspect ratio preservation)
    if (processedImage.width !== WIDTH || processedImage.height !== HEIGHT) {
      console.log(`🔄 Resizing from ${processedImage.width}x${processedImage.height} to ${WIDTH}x${HEIGHT}`);
      processedImage = processedImage.resize(WIDTH, HEIGHT);
      console.log(`✅ Final size: ${processedImage.width}x${processedImage.height}`);
    }

    // Encode back to PNG
    const pngBytes = await processedImage.encode();
    console.log(`💾 Final image size: ${pngBytes.length} bytes`);

    return pngBytes;
  } catch (error) {
    console.error('❌ Error resizing image:', error);
    console.log('⚠️  Returning original image without resizing');
    return imageBytes;
  }
}

function detectMimeTypeFromBytes(bytes: Uint8Array): string {
  // Check PNG signature
  if (bytes.length >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47 &&
      bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A) {
    return "image/png";
  }

  // Check JPEG signature
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xD8) {
    return "image/jpeg";
  }

  // Check WebP signature
  if (bytes.length >= 12 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return "image/webp";
  }

  // Check GIF signature
  if (bytes.length >= 6 &&
      bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 &&
      bytes[3] === 0x38 && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) {
    return "image/gif";
  }

  // Default fallback
  return "image/jpeg";
}

async function fetchImageAsBase64(imageUrl: string): Promise<{data: string, mimeType: string}> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      throw new Error("Image URL expired or not accessible");
    }
    throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
  }

  // Try to get MIME type from response headers first
  let mimeType = response.headers.get("content-type");

  const arrayBuffer = await response.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  // If no MIME type from headers, detect from bytes
  if (!mimeType || !mimeType.startsWith("image/")) {
    mimeType = detectMimeTypeFromBytes(uint8Array);
  }

  let binary = '';
  for (let i = 0; i < uint8Array.byteLength; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }

  return {
    data: btoa(binary),
    mimeType: mimeType
  };
}

async function analyzeImagesWithGemini(prompt: string, subjectImageUrl?: string, referenceImageUrls?: string[]) {
  const parts: any[] = [{ text: `STYLE TRANSFER TASK: Create a new image inspired by the reference image's composition and style, featuring the subject person.

Base prompt: "${prompt}"

INSTRUCTIONS:
1. REFERENCE IMAGE ANALYSIS: Analyze the reference image(s) for:
   - Pose, body positioning, and gesture
   - Camera angle and framing
   - Lighting direction, mood, and atmosphere
   - Background elements, colors, and textures
   - Clothing style, accessories, and details
   - Artistic style, color palette, and visual tone
   - Text, logos, or graphic elements

2. SUBJECT ANALYSIS: If subject image provided, identify:
   - Person's facial features, hair color/style, skin tone
   - Age, gender, and distinctive characteristics
   - Natural facial expression and head positioning

3. STYLE TRANSFER PROMPT: Create a prompt that:
   - Matches the reference image's composition and visual style
   - Features the subject person in the same pose and setting
   - Maintains similar lighting, color palette, and mood
   - Incorporates the same background and environmental elements
   - Preserves the artistic style and visual tone

OUTPUT FORMAT: "Create an image featuring [subject description] in the style of the reference: [composition details], [lighting and mood], [background elements], [color palette], [artistic style]. The person should be positioned [pose description] with [clothing/accessories details]."

Focus on style matching and natural subject integration.` }];

  // Add reference images if provided
  if (referenceImageUrls && referenceImageUrls.length > 0) {
    for (const refUrl of referenceImageUrls) {
      const imageData = await fetchImageAsBase64(refUrl);
      parts.push({
        inlineData: {
          mimeType: imageData.mimeType,
          data: imageData.data
        }
      });
    }
  }

  // Add subject image if provided
  if (subjectImageUrl) {
    const imageData = await fetchImageAsBase64(subjectImageUrl);
    parts.push({
      inlineData: {
        mimeType: imageData.mimeType,
        data: imageData.data
      }
    });
  }

  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-exp:generateContent",
    {
      method: "POST",
      headers: {
        "x-goog-api-key": GEMINI_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{
          parts: parts
        }],
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.8,
          maxOutputTokens: 1000,
          responseModalities: ["TEXT", "IMAGE"]
        }
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const result = await response.json();

  if (!result.candidates || !result.candidates[0] || !result.candidates[0].content) {
    throw new Error("No content generated from Gemini API");
  }

  // Extract the generated description
  const content = result.candidates[0].content;
  const enhancedPrompt = content.parts?.[0]?.text || prompt;

  return enhancedPrompt;
}

// Retry helper with exponential backoff and jitter
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt < maxRetries - 1) {
        // Exponential backoff with jitter: baseDelay * 2^attempt + random(0-1000ms)
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
        console.log(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay.toFixed(0)}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError!;
}

async function callGeminiImagePreview(prompt: string, subjectImageUrl?: string, referenceImageUrls?: string[], baseImageUrl?: string, isBlankFrame?: boolean, seed?: number) {
  // Create explicit prompt based on mode
  let promptText: string;

  const appIconRules = `PROFESSIONAL APP ICON DESIGN STANDARDS (obey strictly):

TECHNICAL REQUIREMENTS:
• 1024×1024 pixels, perfect square 1:1 aspect ratio
• Full-bleed design: background must touch all four canvas edges
• Rounded-rectangle safe zone: keep important elements away from corners (10-15% margin from edges)
• NO borders, frames, strokes, outlines, vignettes, or drop-shadow rims
• NO black/white bars or letterboxing

DESIGN PRINCIPLES:
• NO people or faces - focus on objects, symbols, or abstract concepts
• ONE clear symbol or object centered - avoid clutter
• Minimalistic composition - remove unnecessary details
• Bold, clean shapes with sharp edges
• Strong visual contrast for instant recognition
• Smooth gradients or flat-color backgrounds
• Symmetrical and balanced composition
• Must be recognizable at small sizes (as small as 29x29px)

AESTHETIC:
• Modern iOS/Android app store quality
• Premium, polished, high-end look
• Consistent lighting and shadows
• Professional color palette
• Clean, crisp edges`;

  if (baseImageUrl) {
    promptText = `${appIconRules}

Edit the given image to transform it into a professional app icon following all standards above.
User request: ${prompt}`;
  } else {
    promptText = `${appIconRules}

Create a professional app icon based on this concept: ${prompt}

Remember: No people/faces, one clear centered symbol, minimalistic, bold shapes, strong contrast, recognizable at small sizes.`;
  }

  const parts: any[] = [{ text: promptText }];

  // Add base image first if provided (for adjustment mode)
  if (baseImageUrl) {
    parts.push({ text: "BASE IMAGE (edit this exact image; maintain full-bleed with no borders):" });
    const baseImageData = await fetchImageAsBase64(baseImageUrl);
    parts.push({
      inlineData: {
        mimeType: baseImageData.mimeType,
        data: baseImageData.data
      }
    });
  }

  // Add reference images if provided
  if (referenceImageUrls && referenceImageUrls.length > 0) {
    for (let i = 0; i < referenceImageUrls.length; i++) {
      parts.push({ text: `REFERENCE IMAGE ${i + 1} (composition only; IGNORE any border/frame/outline in the reference; use interior content only):` });
      const imageData = await fetchImageAsBase64(referenceImageUrls[i]);
      parts.push({
        inlineData: {
          mimeType: imageData.mimeType,
          data: imageData.data
        }
      });
    }
  }

  // Add subject image if provided
  if (subjectImageUrl) {
    parts.push({ text: "SUBJECT IMAGE (face/body to insert; output must be full-bleed with no borders):" });
    const imageData = await fetchImageAsBase64(subjectImageUrl);
    parts.push({
      inlineData: {
        mimeType: imageData.mimeType,
        data: imageData.data
      }
    });
  }

  console.log('🔵 Making Gemini API request with config:', {
    endpoint: IMAGE_PREVIEW_ENDPOINT,
    promptLength: promptText.length,
    partsCount: parts.length,
    seed: seed
  });

  const response = await fetch(IMAGE_PREVIEW_ENDPOINT, {
    method: "POST",
    headers: {
      "x-goog-api-key": GEMINI_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [{
        parts: parts
      }],
      generationConfig: {
        temperature: seed ? 0.9 : 0.7, // Higher temperature for more variation when seed is provided
        topK: 40,
        topP: 0.8,
        maxOutputTokens: 8000,
        responseModalities: ["IMAGE"], // ONLY IMAGE - no text fallback
        ...(seed && { seed }) // Add seed if provided for unique generations
      },
      systemInstruction: {
        parts: [{
          text: "You are an expert app icon designer specializing in iOS and Android app store standards. Create professional, minimalistic icons in 1024x1024 pixels with strong visual impact. Focus on single, clear symbols without people or faces. Design for instant recognition at small sizes with bold shapes, strong contrast, and polished aesthetics. Always output perfect squares with rounded-rectangle safe zones."
        }]
      }
    }),
  });

  console.log('🟢 Gemini API responded with status:', response.status);

  if (!response.ok) {
    const errorText = await response.text();
    console.error('🔴 Gemini API error response:', errorText);
    throw new Error(`Gemini Image Preview API error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const result = await response.json();
  console.log('📦 Gemini API result structure:', {
    hasCandidates: !!result.candidates,
    candidatesCount: result.candidates?.length,
    firstCandidateHasContent: !!result.candidates?.[0]?.content,
    firstCandidatePartsCount: result.candidates?.[0]?.content?.parts?.length,
    finishReason: result.candidates?.[0]?.finishReason,
    safetyRatings: result.candidates?.[0]?.safetyRatings
  });

  if (!result.candidates || !result.candidates[0]) {
    console.error('❌ No candidates in response');
    throw new Error("No candidates in Gemini response");
  }

  if (!result.candidates[0].content) {
    console.error('❌ No content in first candidate. Full candidate:', JSON.stringify(result.candidates[0], null, 2));
    const finishReason = result.candidates[0].finishReason;
    if (finishReason === 'SAFETY') {
      throw new Error("Content blocked by safety filters. Try a different prompt.");
    }
    throw new Error(`No content generated. Finish reason: ${finishReason || 'unknown'}`);
  }

  // Check if the response contains image data
  const content = result.candidates[0].content;
  console.log('🔍 Checking content parts:', {
    hasParts: !!content.parts,
    partsCount: content.parts?.length,
    partTypes: content.parts?.map((p: any) => ({
      hasInlineData: !!p.inlineData,
      hasText: !!p.text,
      mimeType: p.inlineData?.mimeType
    }))
  });

  if (content.parts && content.parts.length > 0) {
    // Find the first part with image data
    for (const part of content.parts) {
      if (part.inlineData && part.inlineData.mimeType && part.inlineData.mimeType.startsWith("image/")) {
        console.log('✅ Found image data! MimeType:', part.inlineData.mimeType);
        const imageData = part.inlineData.data;
        return b64ToUint8(imageData);
      }
      if (part.text) {
        console.log('📝 Found text response:', part.text.substring(0, 200));
      }
    }
    // No image found in any part
    console.error('❌ No image found in response parts');
    throw new Error("Gemini Image Preview did not return image data");
  } else {
    // No parts in response
    console.error('❌ Response has no parts');
    throw new Error("Gemini Image Preview returned empty response");
  }
}

async function callImagen(prompt: string): Promise<Uint8Array> {
  // TEMPORARY: Return a demo message until billing is enabled
  // You need to enable billing in Google AI Studio to use Imagen API

  throw new Error(`Imagen API requires billing to be enabled.

To fix this:
1. Go to Google AI Studio (ai.google.dev)
2. Enable billing for your project
3. The Imagen API costs $0.04 per image

Your prompt was: "${prompt}"

Alternatively, you can:
- Use free alternatives like Hugging Face's FLUX.1
- Use OpenAI DALL-E (also requires billing)
- Use local Stable Diffusion models`);
}

async function createMaskedImage(baseImageUrl: string, maskSvgPath: string): Promise<string> {
  // This function creates a composite image with the mask overlay painted on it
  // The mask will be rendered as a semi-transparent red overlay

  // Since Deno doesn't have native canvas support, we'll use an external service
  // or send the SVG path as metadata for the AI to interpret

  // For now, we'll return the original image URL and rely on the AI's vision
  // to see the red overlay we're drawing on the frontend
  // In a production system, you'd want to:
  // 1. Use a canvas library to composite the mask onto the image
  // 2. Or use an external service like Cloudinary to overlay the mask
  // 3. Or send mask coordinates as structured data

  console.log('Mask path received:', maskSvgPath);
  return baseImageUrl;
}

serve(async (req: Request) => {
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    // Auth disabled for testing - re-enable in production
    // const { data: { user } } = await supabase.auth.getUser();
    // if (!user) return new Response("Unauthorized", { status: 401 });

    const { prompt, subjectImageUrl, referenceImageUrls, baseImageUrl, adjustmentMode, allowTextFallback, eraseMask }: GenerateBody = await req.json().catch(() => ({} as any));
    if (!prompt || typeof prompt !== "string")
      return new Response("Missing prompt", { status: 400 });

    // If eraseMask is provided, we're doing inpainting
    let effectiveBaseImageUrl = baseImageUrl;
    if (eraseMask && baseImageUrl) {
      console.log('Inpainting mode: mask provided');
      // In a full implementation, you would composite the mask onto the image here
      // For now, we rely on the visual red overlay the user already sees on their screen
      effectiveBaseImageUrl = await createMaskedImage(baseImageUrl, eraseMask);
    }

    // Use blank frame reference if not in adjustment mode and no base image provided
    let blankFrameUrl: string | undefined;
    if (!baseImageUrl && !adjustmentMode) {
      // Use the pre-uploaded blank frame from Supabase assets bucket
      blankFrameUrl = "https://zxklggjxauvvesqwqvgi.supabase.co/storage/v1/object/sign/assets/1280x720.jpg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8xZjhhYzAxYi05MTVjLTQ0YWItOGNmZi1iZTE1MGI3Y2IwNjgiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJhc3NldHMvMTI4MHg3MjAuanBnIiwiaWF0IjoxNzU5ODg4NzM5LCJleHAiOjQ5MTM0ODg3Mzl9.9hJa0Js0yoNpbaJACIsXtm_7QxSQLCZq-ZnpLsARsKw";
      console.log('Using blank frame reference for proper framing');
    }

    let finalPrompt = prompt;

    // Enhanced prompt for style transfer with subject integration
    if (subjectImageUrl && referenceImageUrls && referenceImageUrls.length > 0) {
      finalPrompt = `STYLE TRANSFER: Create a 1024x1024 square icon featuring the subject person in the style and composition of the reference image. Match the reference's pose, lighting, color palette, background elements, and artistic style while naturally integrating the subject person. Maintain the visual mood and framing of the reference. ${prompt}`;
    } else if (referenceImageUrls && referenceImageUrls.length > 0) {
      finalPrompt = `Create a 1024x1024 square icon inspired by the reference image(s) incorporating this concept: ${prompt}. Match the composition, lighting, and visual style.`;
    } else if (subjectImageUrl) {
      finalPrompt = `Create a 1024x1024 square icon featuring the person from the uploaded image: ${prompt}.`;
    }

    console.log('Generating with prompt:', finalPrompt);
    console.log('Subject image URL:', subjectImageUrl);
    console.log('Reference image URLs:', referenceImageUrls);
    console.log('Base image URL (adjustment mode):', baseImageUrl);
    console.log('Adjustment mode:', adjustmentMode);

    // Always use Gemini Image Preview for image generation
    if (baseImageUrl) {
      console.log('Using Gemini Image Preview for adjustment mode with base image...');
    } else if (subjectImageUrl || (referenceImageUrls && referenceImageUrls.length > 0)) {
      console.log('Using Gemini Image Preview for direct image generation with images...');
    } else {
      console.log('Using Gemini Image Preview for text-only generation...');
    }

    // Use blank frame as base image if available and no other base image
    const effectiveBaseImage = effectiveBaseImageUrl || blankFrameUrl;
    const isUsingBlankFrame = !effectiveBaseImageUrl && !!blankFrameUrl;

    // Generate single image with retry logic
    const randomSeed = Math.floor(Math.random() * 1000000);
    const generateWithRetry = () =>
      retryWithBackoff(() =>
        callGeminiImagePreview(finalPrompt, subjectImageUrl, referenceImageUrls, effectiveBaseImage, isUsingBlankFrame, randomSeed)
      );

    console.log('🎨 Image generated successfully, preparing to upload...');
    const rawImageBytes = await generateWithRetry();
    console.log('📏 Raw image size:', rawImageBytes.length, 'bytes');

    // Resize image to exactly 1024x1024
    const imageBytes = await resizeImageTo1024x1024(rawImageBytes);

    // Get user ID from auth for namespacing
    console.log('👤 Getting user ID...');
    const { data: { user } } = await supabase.auth.getUser();
    const userId = user?.id || 'anonymous';
    console.log('👤 User ID:', userId);

    // Store single image to Supabase Storage with user-specific path
    const filename = `${userId}/${crypto.randomUUID()}.png`;
    console.log('💾 Uploading to storage:', filename);

    const upload = await supabase.storage.from("thumbnails").upload(filename, imageBytes, { contentType: "image/png", upsert: true });

    if (upload.error) {
      console.error('❌ Storage upload error:', upload.error);
      throw upload.error;
    }
    console.log('✅ Upload successful!');

    // Generate long-lived signed URL (7 days)
    // The app will download this to permanent local storage immediately
    const SEVEN_DAYS = 7 * 24 * 60 * 60; // 7 days in seconds
    console.log('🔗 Creating signed URL...');
    const signed = await supabase.storage.from("thumbnails").createSignedUrl(filename, SEVEN_DAYS);

    if (signed.error) {
      console.error('❌ Signed URL error:', signed.error);
      throw signed.error;
    }
    console.log('✅ Signed URL created:', signed.data?.signedUrl?.substring(0, 50) + '...');

    console.log('📤 Sending response to client...');
    return new Response(JSON.stringify({
      imageUrl: signed.data?.signedUrl,
      url: signed.data?.signedUrl,
      width: WIDTH,
      height: HEIGHT,
      file: filename,
      prompt: finalPrompt
    }), { headers: { "Content-Type": "application/json" } });

  } catch (e) {
    console.error(e);
    const errorMessage = String(e);

    // Determine if this is a transient error (API issues, rate limits, etc.)
    const isTransient = errorMessage.includes('API error') ||
                       errorMessage.includes('rate limit') ||
                       errorMessage.includes('timeout') ||
                       errorMessage.includes('temporarily unavailable') ||
                       errorMessage.includes('network') ||
                       errorMessage.includes('fetch');

    if (isTransient) {
      return new Response(JSON.stringify({
        error: 'Image generation service temporarily unavailable. Please try again.',
        details: errorMessage
      }), {
        status: 503,
        headers: { "Content-Type": "application/json", "Retry-After": "60" }
      });
    }

    // For other errors (user errors, permanent failures), return 500
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
});
