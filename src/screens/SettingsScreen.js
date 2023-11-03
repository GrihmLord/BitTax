import React from 'react';
import { View, Text, Button, StyleSheet, Alert } from 'react-native';
import PropTypes from 'prop-types'; // Import PropTypes

export default function SettingsScreen({ navigation }) {
  
  const handleLogout = () => {
    // Here you would clear the user's session/token
    Alert.alert('Logged Out', 'You have been successfully logged out.');
    // Then navigate to the login screen or another appropriate screen
    // navigation.navigate('LoginScreen');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Settings</Text>
      <Button title="Update Profile" onPress={() => navigation.navigate('ProfileUpdateScreen')} />
      <Button title="Change Password" onPress={() => navigation.navigate('ChangePasswordScreen')} />
      <Button title="Payment Options" onPress={() => navigation.navigate('PaymentOptionsScreen')} />
      <Button title="Log Out" onPress={handleLogout} color="red" />
    </View>
  );
}

// Define the prop types
SettingsScreen.propTypes = {
  navigation: PropTypes.shape({
    navigate: PropTypes.func.isRequired,
    // Add other navigation functions that you use here
  }).isRequired,
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'space-around',
    alignItems: 'center',
    padding: 20,
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold',
  },
});
