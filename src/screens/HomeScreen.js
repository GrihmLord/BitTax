import React from 'react';
import { View, Text, Button, StyleSheet, Alert } from 'react-native';

export default function HomeScreen() {
  const handlePayIRS = () => {
    // Logic to pay IRS
    Alert.alert('Payment to IRS', 'Your payment is being processed.');
  };

  const handleWithdrawBitcoin = () => {
    // Logic to withdraw Bitcoin
    Alert.alert('Withdraw Bitcoin', 'Your withdrawal is being processed.');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.welcome}>Welcome, User</Text>
      <Text style={styles.balance}>IRS Debt: $2000</Text>
      <Text style={styles.balance}>Bitcoin: 0.05 BTC</Text>
      <View style={styles.buttonContainer}>
        <Button title="Pay IRS" onPress={handlePayIRS} />
      </View>
      <View style={styles.buttonContainer}>
        <Button title="Withdraw Bitcoin" onPress={handleWithdrawBitcoin} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5', // Added a background color for better contrast
  },
  welcome: {
    fontSize: 36,
    fontWeight: 'bold',
    marginBottom: 20, // Added margin for better spacing
  },
  balance: {
    fontSize: 24,
    margin: 10,
  },
  buttonContainer: {
    marginVertical: 10, // Added vertical margin for spacing between buttons
    width: '80%', // Set width to make buttons wider
    borderRadius: 5, // Rounded corners for buttons
  },
});
