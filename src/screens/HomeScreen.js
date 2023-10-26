import React from 'react';
import { View, Text, Button, StyleSheet } from 'react-native';

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.welcome}>Welcome, User</Text>
      <Text style={styles.balance}>IRS Debt: $2000</Text>
      <Text style={styles.balance}>Bitcoin: 0.05 BTC</Text>
      <Button title="Pay IRS" onPress={() => {}} />
      <Button title="Withdraw Bitcoin" onPress={() => {}} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  welcome: {
    fontSize: 36,
    fontWeight: 'bold',
  },
  balance: {
    fontSize: 24,
    margin: 10,
  },
});
