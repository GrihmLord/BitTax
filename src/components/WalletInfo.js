import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import PropTypes from 'prop-types';

const WalletInfo = ({ walletData }) => {
  return (
    <View style={styles.container}>
      <Text style={styles.header}>Wallet Information</Text>
      <View style={styles.infoContainer}>
        <Text style={styles.label}>Address:</Text>
        <Text style={styles.value}>{walletData.address}</Text>
      </View>
      <View style={styles.infoContainer}>
        <Text style={styles.label}>Balance:</Text>
        <Text style={styles.value}>{walletData.balance} BTC</Text>
      </View>
      {/* Add more wallet-related information as needed */}
    </View>
  );
};

WalletInfo.propTypes = {
  walletData: PropTypes.shape({
    address: PropTypes.string.isRequired,
    balance: PropTypes.number.isRequired,
  }).isRequired,
};

const styles = StyleSheet.create({
  container: {
    padding: 20,
    borderRadius: 5,
    backgroundColor: '#f7f7f7',
    marginBottom: 20,
  },
  header: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  infoContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  label: {
    fontSize: 16,
    color: '#333',
  },
  value: {
    fontSize: 16,
    fontWeight: '500',
    flexShrink: 1, // allows text to shrink and wrap if too long
  },
});

export default WalletInfo;
