import React, { useEffect } from 'react';
import { View, Text, Button, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { getBitcoinPrice, withdrawBtc } from '../redux/slices/cryptoSlice';
import { payTax } from '../redux/slices/taxSlice';
import { formatCurrency } from '../services/TaxService';
import { convertUsdToBtc } from '../services/BitcoinService';

export default function HomeScreen({ navigation }) {
  const dispatch = useDispatch();

  // Selectors
  const { user } = useSelector((state) => state.auth);
  const { btcBalance, btcPrice, status } = useSelector((state) => state.crypto);
  const { taxDebt } = useSelector((state) => state.tax);

  useEffect(() => {
    dispatch(getBitcoinPrice());
  }, [dispatch]);

  const handlePayIRS = () => {
    const paymentAmount = 500; // Fixed payment for demo
    if (taxDebt <= 0) {
      Alert.alert('Great News', 'You have no tax debt!');
      return;
    }

    // Check if enough BTC
    const btcNeeded = convertUsdToBtc(paymentAmount, btcPrice);

    if (btcBalance >= btcNeeded) {
      dispatch(withdrawBtc(btcNeeded));
      dispatch(payTax(paymentAmount));
      Alert.alert('Payment Successful', `Paid ${formatCurrency(paymentAmount)} to IRS.`);
    } else {
      Alert.alert('Insufficient Funds', 'Not enough Bitcoin to make this payment.');
    }
  };

  const handleWithdrawBitcoin = () => {
    const withdrawAmount = 0.01;
    if (btcBalance >= withdrawAmount) {
      dispatch(withdrawBtc(withdrawAmount));
      Alert.alert('Withdrawal Successful', `Withdrew ${withdrawAmount} BTC.`);
    } else {
      Alert.alert('Error', 'Insufficient Bitcoin balance.');
    }
  };

  const btcValueInUsd = btcBalance * btcPrice;

  return (
    <View style={styles.container}>
      <Text style={styles.welcome}>Welcome, {user ? user.username : 'User'}</Text>

      <View style={styles.card}>
        <Text style={styles.label}>IRS Debt</Text>
        <Text style={styles.debtReference}>{formatCurrency(taxDebt)}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Bitcoin Balance</Text>
        {status === 'loading' ? (
          <ActivityIndicator />
        ) : (
          <>
            <Text style={styles.balance}>{btcBalance.toFixed(4)} BTC</Text>
            <Text style={styles.subBalance}>≈ {formatCurrency(btcValueInUsd)}</Text>
            <Text style={styles.price}>Current Price: {formatCurrency(btcPrice)}</Text>
          </>
        )}
      </View>

      <View style={styles.buttonContainer}>
        <Button title="Pay $500 to IRS" onPress={handlePayIRS} />
      </View>
      <View style={styles.buttonContainer}>
        <Button title="Withdraw Bitcoin" onPress={handleWithdrawBitcoin} />
      </View>
      <View style={styles.buttonContainer}>
        <Button title="Audit Cold Storage" onPress={() => navigation.navigate('Audit')} color="#6200ea" />
      </View>

      <View style={styles.buttonContainer}>
        <Button title="Refresh Price" onPress={() => dispatch(getBitcoinPrice())} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  welcome: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  card: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 10,
    width: '80%',
    alignItems: 'center',
    marginBottom: 15,
    elevation: 3, // Shadow for Android
    shadowColor: '#000', // Shadow for iOS
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  label: {
    fontSize: 16,
    color: '#666',
    marginBottom: 5,
  },
  debtReference: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#d32f2f', // Red for debt
  },
  balance: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#f57c00', // Orange for Bitcoin
  },
  subBalance: {
    fontSize: 16,
    color: '#888',
  },
  price: {
    fontSize: 12,
    color: '#aaa',
    marginTop: 5,
  },
  buttonContainer: {
    marginVertical: 10,
    width: '80%',
    borderRadius: 5,
  },
});
