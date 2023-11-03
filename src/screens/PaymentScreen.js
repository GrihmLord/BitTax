import React, { useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet, Alert } from 'react-native';
import PropTypes from 'prop-types'; // Import PropTypes

export default function PaymentScreen({ navigation }) {
  const [amount, setAmount] = useState('');

  const handlePayment = () => {
    if (amount) {
      // Here you would integrate with your payment API
      Alert.alert('Payment Successful', `You have paid ${amount} BTC towards your taxes.`);
      // After payment, navigate to a confirmation screen or back to the home screen
      // navigation.navigate('ConfirmationScreen');
    } else {
      Alert.alert('Payment Error', 'Please enter the amount you wish to pay.');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Pay Taxes with Bitcoin</Text>
      <TextInput
        placeholder="Amount in BTC"
        value={amount}
        keyboardType="numeric"
        onChangeText={setAmount}
        style={styles.input}
      />
      <Button title="Submit Payment" onPress={handlePayment} />
      <Button title="Go Back" onPress={() => navigation.goBack()} />
    </View>
  );
}

// Define the prop types
PaymentScreen.propTypes = {
  navigation: PropTypes.shape({
    goBack: PropTypes.func.isRequired,
    // Add other navigation functions that you use here
  }).isRequired,
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  input: {
    width: '100%',
    height: 40,
    borderColor: 'gray',
    borderWidth: 1,
    padding: 10,
    marginBottom: 20,
  },
});
