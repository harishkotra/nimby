import demo from '../landing/lifetime-demo.json';

export const licenseDemo = process.env.EXPO_PUBLIC_NIMBY_LICENSE_DEMO === '1';
export const lifetimeTestProduct = licenseDemo ? demo.productId : null;
