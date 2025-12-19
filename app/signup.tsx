import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, KeyboardAvoidingView, Platform, ScrollView, Linking, Image } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { signUpEmail, signInWithApple, signInWithGoogle } from '../src/features/auth/api';
import { createGuestSession, isGuestSession, upgradeGuestToAccount } from '../src/utils/guestSession';

export default function SignUpScreen() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSignUp = async () => {
    if (!name || !email || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    if (password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters long');
      return;
    }

    setIsLoading(true);

    try {
      const data = await signUpEmail(email, password, name);

      if (data.user) {
        // Check if user was a guest and migrate data
        const wasGuest = await isGuestSession();

        if (wasGuest) {
          try {
            await upgradeGuestToAccount(data.user.id);
            Alert.alert(
              'Account Created!',
              'Your purchases and thumbnails have been saved to your account.'
            );
          } catch (migrateError) {
            console.error('Migration error:', migrateError);
            // Continue even if migration fails
          }
        }

        router.push('/loadingaccount');
      }

    } catch (error: any) {
      console.error('Sign up error:', error);
      Alert.alert('Sign Up Error', error.message || 'Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    setIsLoading(true);

    try {
      const data = await signInWithApple();

      if (data.user) {
        // Successfully signed in, navigate to loading account screen
        router.push('/loadingaccount');
      }

    } catch (error: any) {
      console.error('Apple sign in error:', error);
      if (error.message === 'Sign in was canceled') {
        // User canceled, don't show error
        return;
      }
      Alert.alert('Sign In Error', error.message || 'Failed to sign in with Apple. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    // Show informational alert first
    Alert.alert(
      'Secure Sign-In',
      'For sign-in we use Google authentication powered by Supabase (a trusted backend service).',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Continue',
          onPress: async () => {
            setIsLoading(true);

            try {
              const data = await signInWithGoogle();

              if (data.user) {
                // Successfully signed in, navigate to loading account screen
                router.push('/loadingaccount');
              }

            } catch (error: any) {
              console.error('Google sign in error:', error);
              if (error.message === 'Sign in was canceled') {
                // User canceled, don't show error
                return;
              }
              Alert.alert('Sign In Error', error.message || 'Failed to sign in with Google. Please try again.');
            } finally {
              setIsLoading(false);
            }
          }
        }
      ]
    );
  };

  const handleGuestMode = async () => {
    setIsLoading(true);

    try {
      // Create guest session
      await createGuestSession();

      // Navigate to loading screen first (like authenticated users)
      router.push('/loadingaccount');
    } catch (error: any) {
      console.error('Guest mode error:', error);
      Alert.alert('Error', 'Failed to start guest mode. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar style="light" />

      <TouchableOpacity
        style={styles.backButton}
        onPress={() => router.back()}
      >
        <Text style={styles.backButtonText}>← Back</Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>Sign up to start creating amazing thumbnails</Text>
        </View>

        <View style={styles.form}>
          <TouchableOpacity
            style={styles.appleButton}
            onPress={handleAppleSignIn}
            disabled={isLoading}
          >
            <View style={styles.buttonContent}>
              <Image
                source={require('../assets/apple-logo.png')}
                style={styles.buttonIcon}
                resizeMode="contain"
              />
              <Text style={styles.appleButtonText}>
                {isLoading ? 'Signing up...' : 'Sign Up With Apple'}
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.googleButton}
            onPress={handleGoogleSignIn}
            disabled={isLoading}
          >
            <View style={styles.buttonContent}>
              <Image
                source={require('../assets/google-logo.png')}
                style={styles.buttonIcon}
                resizeMode="contain"
              />
              <Text style={styles.googleButtonText}>
                {isLoading ? 'Signing up...' : 'Sign Up With Google'}
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.guestButton}
            onPress={handleGuestMode}
            disabled={isLoading}
          >
            <Text style={styles.guestButtonText}>Continue as Guest</Text>
            <Text style={styles.guestButtonSubtext}>Try the app without an account</Text>
          </TouchableOpacity>

          <View style={styles.dividerContainer}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Name</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your name"
              placeholderTextColor={MUTED}
              value={name}
              onChangeText={setName}
              autoComplete="name"
            />
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your email"
              placeholderTextColor={MUTED}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.passwordContainer}>
              <TextInput
                style={styles.passwordInput}
                placeholder="Enter your password"
                placeholderTextColor={MUTED}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoComplete="password"
              />
              <TouchableOpacity
                style={styles.eyeIcon}
                onPress={() => setShowPassword(!showPassword)}
              >
                <Text style={styles.eyeIconText}>{showPassword ? 'Hide' : 'Show'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.signUpButton, isLoading && styles.signUpButtonDisabled]}
            onPress={handleSignUp}
            disabled={isLoading}
          >
            <Text style={styles.signUpButtonText}>
              {isLoading ? 'Creating Account...' : 'Sign Up'}
            </Text>
          </TouchableOpacity>

          <View style={styles.loginContainer}>
            <Text style={styles.loginText}>Already have an account? </Text>
            <TouchableOpacity onPress={() => router.push('/login')}>
              <Text style={styles.loginLink}>Log In</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.termsContainer}>
            <Text style={styles.termsText}>
              By creating an account, you indicate that you have read and agreed to the{' '}
              <Text
                style={styles.termsLink}
                onPress={() => Linking.openURL('https://dlo137.github.io/Privacy-Policy-Thumbnail-Generator/')}
              >
                privacy policy
              </Text>
              {' '}and{' '}
              <Text
                style={styles.termsLink}
                onPress={() => Linking.openURL('https://www.apple.com/legal/internet-services/itunes/dev/stdeula/')}
              >
                terms of use
              </Text>
            </Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
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
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 40,
    minHeight: '100%',
  },
  header: {
    marginTop: 60,
    marginBottom: 40,
    alignItems: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: TEXT,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: MUTED,
    textAlign: 'center',
    lineHeight: 24,
  },
  form: {
    maxWidth: 400,
    alignSelf: 'center',
    width: '100%',
  },
  inputContainer: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: TEXT,
    marginBottom: 8,
  },
  input: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 16,
    color: TEXT,
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 16,
    color: TEXT,
  },
  eyeIcon: {
    paddingHorizontal: 16,
  },
  eyeIconText: {
    fontSize: 14,
    color: '#93c5fd',
    fontWeight: '600',
  },
  signUpButton: {
    backgroundColor: '#1e40af',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 20,
    shadowColor: '#1e40af',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  signUpButtonDisabled: {
    opacity: 0.6,
  },
  signUpButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
  },
  loginContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
  },
  loginText: {
    fontSize: 16,
    color: MUTED,
  },
  loginLink: {
    fontSize: 16,
    color: '#93c5fd',
    fontWeight: '600',
  },
  backButton: {
    position: 'absolute',
    top: 50,
    left: 24,
    zIndex: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  backButtonText: {
    fontSize: 16,
    color: '#93c5fd',
    fontWeight: '600',
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: BORDER,
  },
  dividerText: {
    color: MUTED,
    fontSize: 14,
    marginHorizontal: 16,
  },
  appleButton: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  appleButtonText: {
    color: TEXT,
    fontSize: 16,
    fontWeight: '600',
  },
  googleButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DADCE0',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  googleButtonText: {
    color: '#3C4043',
    fontSize: 16,
    fontWeight: '600',
  },
  guestButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#4b5563',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    marginTop: 8,
  },
  guestButtonText: {
    color: '#93c5fd',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  guestButtonSubtext: {
    color: '#8a9099',
    fontSize: 12,
    fontWeight: '400',
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonIcon: {
    width: 20,
    height: 20,
    marginRight: 12,
  },
  termsContainer: {
    marginTop: 16,
  },
  termsText: {
    fontSize: 12,
    color: MUTED,
    textAlign: 'center',
    lineHeight: 18,
  },
  termsLink: {
    textDecorationLine: 'underline',
  },
});