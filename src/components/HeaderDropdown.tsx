import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, Platform, Linking, Alert } from 'react-native';

interface HeaderDropdownProps {
  isVisible: boolean;
  onClose: () => void;
  onAbout: () => void;
  onContact: () => void;
  onUpgrade: () => void;
  onBilling: () => void;
}

const BG = '#0b0f14';
const CARD = '#151a21';
const BORDER = '#232932';
const TEXT = '#e7ebf0';
const MUTED = '#8a9099';

export default function HeaderDropdown({
  isVisible,
  onClose,
  onAbout,
  onContact,
  onUpgrade,
  onBilling
}: HeaderDropdownProps) {

  const handleRateApp = async () => {
    onClose();

    try {
      const appStoreUrl = Platform.OS === 'ios'
        ? 'itms-apps://itunes.apple.com/app/id6755940269?action=write-review'
        : 'market://details?id=com.watsonsweb.icongenerator';

      const fallbackUrl = Platform.OS === 'ios'
        ? 'https://apps.apple.com/app/id6755940269'
        : 'https://play.google.com/store/apps/details?id=com.watsonsweb.icongenerator';

      const canOpen = await Linking.canOpenURL(appStoreUrl);

      if (canOpen) {
        await Linking.openURL(appStoreUrl);
      } else {
        await Linking.openURL(fallbackUrl);
      }
    } catch (error) {
      Alert.alert('Error', 'Unable to open app store. Please visit the app store manually to rate our app.');
    }
  };

  const menuItems = [
    { id: 'about', title: 'About', onPress: () => { onClose(); onAbout(); } },
    { id: 'rate', title: 'Rate the App', onPress: handleRateApp },
    { id: 'help', title: 'Help & Support', onPress: () => { onClose(); onContact(); } },
    { id: 'upgrade', title: 'Upgrade', onPress: () => { onClose(); onUpgrade(); } },
    { id: 'billing', title: 'Billing', onPress: () => { onClose(); onBilling(); } },
  ];

  return (
    <Modal
      visible={isVisible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <View style={styles.dropdown}>
          {menuItems.map((item, index) => (
            <TouchableOpacity
              key={item.id}
              style={[
                styles.menuItem,
                index === menuItems.length - 1 && styles.lastMenuItem
              ]}
              onPress={item.onPress}
            >
              <Text style={styles.menuItemText}>{item.title}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
  },
  dropdown: {
    backgroundColor: CARD,
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 12,
    marginTop: 60, // Position below header
    marginLeft: 15,
    minWidth: 180,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  menuItem: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  lastMenuItem: {
    borderBottomWidth: 0,
  },
  menuItemText: {
    fontSize: 16,
    color: TEXT,
    fontWeight: '500',
  },
});