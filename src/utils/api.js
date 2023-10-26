export const fetchTaxData = () => {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          status: 'success',
          data: {
            taxOwed: 1000,
            taxPaid: 500,
          },
        });
      }, 2000);
    });
  };
  