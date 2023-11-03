import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import Constants from './constants'; // Assume you have a constants file

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Open up App.tsx to start working on your app!</Text>
      <StatusBar style="light" />
    </View>
  );
}

// If you have a constants file, you can import and use it here
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Constants.colors.background, // e.g., '#282c34'
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: Constants.colors.text, // e.g., '#ffffff'
    fontSize: 16,
  },
});
