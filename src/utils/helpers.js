/**
 * Simulates fetching tax data from an API.
 * @param {number} [delay=2000] - The number of milliseconds to delay the response.
 * @param {boolean} [shouldFail=false] - Whether the promise should simulate a failure.
 * @returns {Promise<Object>} A promise that resolves with the tax data or rejects with an error.
 */
export const fetchTaxData = (delay = 2000, shouldFail = false) => {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (shouldFail) {
          // Reject with an Error object
          reject(new Error('Internal Server Error'));
        } else {
          resolve({
            status: 200,
            data: {
              taxOwed: 1000,
              taxPaid: 500,
            },
          });
        }
      }, delay);
    });
  };
  