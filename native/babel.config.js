module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    /* worklets 플러그인은 **맨 마지막**이어야 한다. 긋기가 전부 worklet이라
       이게 빠지면 손짓이 통째로 JS 스레드로 떨어진다 (HANDOFF §11) */
    plugins: ['react-native-worklets/plugin'],
  };
};
