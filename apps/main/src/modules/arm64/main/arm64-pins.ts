const unityVersion = '6000.0.40f1';

export const arm64Pins = {
   unityVersion,
   unityPlayer: {
      url: `https://download.unity3d.com/download_unity/157d81624ddf/MacEditorTargetInstaller/UnitySetup-Windows-Mono-Support-for-Editor-${unityVersion}.pkg`,
      range: 'bytes=87691-231822986',
      directory: 'Variations/win_arm64_player_nondevelopment_mono/',
      files: {
         'WindowsPlayer.exe': { target: 'Beat Saber.exe', sha256: '87d6cb42e307a70857f1378a80ef1d332632635c75d502a1e645c2d2719cae89' },
         'UnityPlayer.dll': { target: 'UnityPlayer.dll', sha256: 'b9b68aeaa8ee74f99935f72e0552ca924834a7769f14aedc397bde1d1585361d' },
         'MonoBleedingEdge/EmbedRuntime/mono-2.0-bdwgc.dll': {
            target: 'MonoBleedingEdge/EmbedRuntime/mono-2.0-bdwgc.dll',
            sha256: '3474b6c716fc7b6ffeb3d91cda691fa4d2392817844424bf693aa2343f93ceb3'
         },
         'UnityCrashHandler64.exe': { target: 'UnityCrashHandler64.exe', sha256: '5847e08fa52290a253c42eb829359e03876dc29bc5a4cce208310dc7a02f19ee' }
      }
   },
   unityOpenXR: {
      url: 'https://download.packages.unity.com/com.unity.xr.openxr/-/com.unity.xr.openxr-1.14.3.tgz',
      entry: 'package/Runtime/universalwindows/arm64/UnityOpenXR.dll',
      target: 'Beat Saber_Data/Plugins/ARM64/UnityOpenXR.dll',
      patches: [
         { offset: 0x79c4a, from: 'LoadPackagedLibrary', to: 'LoadLibraryW' },
         { offset: 0x79cb2, from: 'api-ms-win-core-libraryloader-l2-1-0.dll', to: 'kernel32.dll' },
         { offset: 0x7ac0e, from: 'MSVCP140_APP.dll', to: 'msvcp140.dll' },
         { offset: 0x7ad56, from: 'VCRUNTIME140_APP.dll', to: 'vcruntime140.dll' }
      ],
      sha256: '676c20f8e1b55d25512d5b34e0195524ccb3d08513a2111d1dd22356c1b6a31a'
   },
   armonica: {
      commit: '523232',
      publicKey: `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA7qDUSB9U6nWed2m7+lDi
zEZfICzXEMrApSHeEmwA5LjIxCWYJvXREwut7TwXtWJgNJOSVXz0MzlvhFgaaOIn
ThwLvFOGVdMmPY/RjOJtrItqnIk/Y+opqSUTFquZHiYyCEX1DCefhgwe8RA6dfwQ
j//bKHO37Rw0KvsDqN+WX/01NLR2IE3hPSOh2xWxpXKcG/oisaf5Ft8Xsvyr/55z
WzAVL5GaoaJE+Dhx9hSlE3cAvNfyiHWb/14iIZIYCCYeACPeA8ElKoQ3b2CbQnWC
CVX2PY8utVME4/N3zViE0SfyiAKmQV9YEoUmK0qPX20OL/qMmB1W5At93/h+Yi9X
Sg82xC8D1COT31sEIgxqewjfiJ7lz5PlV542EEKPPZ5y+7xG9mC8ls28JfiEyrAt
pBUxlZMeG/4RNlbvgOmFWEDCNg8FOwXDknLWKfXlSKIa4llTdptVwAn0joJf+Ogn
7kUJYjWGWyf3J84LSxeT5noAroK7DaBjCDu1hovTAb+scccQk2Q9OAcwEOW/Z+AN
a59G7TaVFNNbyNgjZWP85Wfcz2P8FSlZeNWSIvC6Rtq6/7hjYycpsav8+6OcjoTE
DbG8Awv9kScMInh9aDUT+FUP0QtzvYjF6wc9XTdluRZborCDCRePHS5rjb/nKeuf
1KbxHfNuvX1uMopYIGnz3TkCAwEAAQ==
-----END PUBLIC KEY-----`,
      replaces: new Map([['Libs/MonoMod.Core.dll', /1\.3\.3(-alpha\.dev)?\+aa4a84749/]])
   }
};
