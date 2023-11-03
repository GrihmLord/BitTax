import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import PropTypes from 'prop-types';

const TaxInfo = ({ taxData }) => {
  return (
    <View style={styles.container}>
      <Text style={styles.header}>Tax Information</Text>
      <View style={styles.infoContainer}>
        <Text style={styles.label}>Tax Year:</Text>
        <Text style={styles.value}>{taxData.year}</Text>
      </View>
      <View style={styles.infoContainer}>
        <Text style={styles.label}>Amount Due:</Text>
        <Text style={styles.value}>${taxData.amountDue.toFixed(2)}</Text>
      </View>
      <View style={styles.infoContainer}>
        <Text style={styles.label}>Payment Status:</Text>
        <Text style={styles.value}>{taxData.paymentStatus}</Text>
      </View>
      {/* Add more tax-related information as needed */}
    </View>
  );
};

TaxInfo.propTypes = {
  taxData: PropTypes.shape({
    year: PropTypes.number.isRequired,
    amountDue: PropTypes.number.isRequired,
    paymentStatus: PropTypes.string.isRequired,
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
  },
});

export default TaxInfo;
