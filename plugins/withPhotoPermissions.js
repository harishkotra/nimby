const { withAndroidManifest, withAppBuildGradle, withGradleProperties } = require('expo/config-plugins');

const withPhotoPermissions = (config) => withAndroidManifest(config, (result) => {
  const manifest = result.modResults.manifest;
  if (manifest.application?.[0]) {
    delete manifest.application[0].$['android:requestLegacyExternalStorage'];
  }
  const legacy = 'android.permission.READ_EXTERNAL_STORAGE';
  const permissions = (manifest['uses-permission'] ??= []);
  const existing = permissions.find((item) => item.$['android:name'] === legacy);
  if (existing) {
    existing.$['android:maxSdkVersion'] = '32';
  } else {
    permissions.push({ $: { 'android:name': legacy, 'android:maxSdkVersion': '32' } });
  }
  return result;
});

const withEyeCpuRuntime = (config) => withAppBuildGradle(config, (result) => {
  const exclusions = "android.packagingOptions.jniLibs.excludes.addAll(['**/libLiteRtGpuAccelerator.so', '**/libLiteRtClGlAccelerator.so'])";
  if (!result.modResults.contents.includes(exclusions)) {
    result.modResults.contents += `\n// Eye 4.3 falls back to CPU when its OpenCL accelerator is absent.\n${exclusions}\n`;
  }
  return result;
});

module.exports = (config) => withGradleProperties(withEyeCpuRuntime(withPhotoPermissions(config)), (result) => {
  // Eye 4.3.0 supplies native libraries for these two architectures.
  result.modResults = result.modResults.filter((entry) => entry.type !== 'property' || entry.key !== 'reactNativeArchitectures');
  result.modResults.push({ type: 'property', key: 'reactNativeArchitectures', value: 'arm64-v8a,x86_64' });
  return result;
});
