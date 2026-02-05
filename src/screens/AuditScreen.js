import React, { useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet, FlatList, Alert } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { importWallet } from '../redux/slices/cryptoSlice';
import { deriveAddressesFromXpub } from '../services/AuditService';

export default function AuditScreen() {
    const [xpub, setXpub] = useState('');
    const dispatch = useDispatch();
    const { addresses, btcBalance } = useSelector((state) => state.crypto);

    const handleImport = () => {
        try {
            const derived = deriveAddressesFromXpub(xpub);
            dispatch(importWallet({ xpub, addresses: derived }));
            Alert.alert('Success', 'Wallet imported successfully.');
        } catch (error) {
            Alert.alert('Error', error.message);
        }
    };

    const renderItem = ({ item }) => (
        <View style={styles.row}>
            <Text style={styles.cell}>{item.address.substring(0, 10)}...</Text>
            <Text style={styles.cell}>{item.balance} BTC</Text>
            <Text style={styles.cell}>{item.transactions} Txns</Text>
        </View>
    );

    return (
        <View style={styles.container}>
            <Text style={styles.title}>Cold Storage Audit</Text>

            <View style={styles.inputContainer}>
                <TextInput
                    style={styles.input}
                    placeholder="Paste your XPUB, YPUB, or ZPUB"
                    value={xpub}
                    onChangeText={setXpub}
                />
                <Button title="Audit Wallet" onPress={handleImport} />
            </View>

            <Text style={styles.subtitle}>Total Balance: {btcBalance.toFixed(4)} BTC</Text>

            <View style={styles.tableHeader}>
                <Text style={styles.headerCell}>Address</Text>
                <Text style={styles.headerCell}>Balance</Text>
                <Text style={styles.headerCell}>Count</Text>
            </View>

            <FlatList
                data={addresses || []}
                keyExtractor={(item) => item.address}
                renderItem={renderItem}
                ListEmptyComponent={<Text style={styles.empty}>No wallet imported yet.</Text>}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, padding: 20, backgroundColor: '#fff' },
    title: { fontSize: 24, fontWeight: 'bold', marginBottom: 20, marginTop: 40 },
    inputContainer: { flexDirection: 'row', marginBottom: 20 },
    input: { flex: 1, borderBottomWidth: 1, marginRight: 10, padding: 5 },
    subtitle: { fontSize: 18, marginVertical: 10, fontWeight: '600' },
    tableHeader: { flexDirection: 'row', borderBottomWidth: 2, paddingBottom: 5, marginTop: 10 },
    headerCell: { flex: 1, fontWeight: 'bold' },
    row: { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
    cell: { flex: 1 },
    empty: { marginTop: 20, color: '#888', fontStyle: 'italic' },
});
