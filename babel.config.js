// babel.config.js
module.exports = function(api) {
  api.cache(true);

  // Declare presets and plugins arrays
  const presets = ['babel-preset-expo'];
  const plugins = [];

  // Example: Add a plugin only in development mode
  if (api.env('development')) {
    plugins.push('react-refresh/babel');
  }

  // Return the configuration object with presets and plugins
  return {
    presets,
    plugins,
  };
};
