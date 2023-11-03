import React from 'react';
import PropTypes from 'prop-types';
import { Provider } from 'react-redux';
import store from './src/redux/store';
import AppNavigator from './src/navigation/AppNavigator';
import { SafeAreaView, StatusBar, Text } from 'react-native';

// Error Boundary Component
class ErrorBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI.
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // You can also log the error to an error reporting service
    logErrorToMyService(error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      // You can render any custom fallback UI
      return <Text>Something went wrong.</Text>;
    }

    return this.props.children;
  }
}

// Define prop types for ErrorBoundary
ErrorBoundary.propTypes = {
  children: PropTypes.node.isRequired,
};

// Function to log errors to a service
function logErrorToMyService(error, errorInfo) {
  // Implementation of error logging
}

export default function App() {
  return (
    <Provider store={store}>
      <ErrorBoundary>
        <SafeAreaView style={{ flex: 1 }}>
          <StatusBar barStyle="dark-content" />
          <AppNavigator />
        </SafeAreaView>
      </ErrorBoundary>
    </Provider>
  );
}
