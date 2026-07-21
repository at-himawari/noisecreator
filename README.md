# Rain sound generator

外部の録音素材を使わず、Webブラウザ上で自然なステレオ雨音を生成・再生できます。

## 使い方

Finderで `web/index.html` をダブルクリックして開きます。

雨音の合成とMP3エンコードはすべてブラウザ内で行われ、音声データが外部へ送信される
ことはありません。画面上で長さと雨量を選び、生成したMP3をそのまま再生または保存
できます。「連続モード」を有効にすると、停止ボタンを押すまでブラウザ内で雨音を再生し
続けます。

## 音の構成とデータソース

外部の雨音素材は使用せず、広帯域ノイズ、低域ノイズ、左右で異なるノイズ成分、ポアソン過程で
発生する小粒・中粒・大粒、数秒単位の雨量変動を合成します。雨滴は発振器ではなく短いノイズ
バーストを高域の衝突成分と低域の着地成分へ分岐します。雨滴ごとに葉・土、窓・屋根、水たまり
の特性を選びます。背景に埋もれない独立した滴下音も不規則に加え、44.1 kHz・2チャンネル・
192 kbpsのMP3に書き出します。

連続モードはWeb Audio APIのバンドパス／ローパスフィルターを通した2種類のノイズ床へ、
ランダムなステレオ雨滴を重ねます。雨量スライダーは背景音量と雨滴の発生頻度を変更し、小雨域
では背景を抑えて間隔の空いた小粒・中粒を前面に出します。

実装に利用した仕様・資料:

- FFmpeg: https://ffmpeg.org/ffmpeg.html
- lamejs: https://github.com/zhuker/lamejs
- LAME: https://lame.sourceforge.io/
- Cheng and Liu, "Physically-based Statistical Simulation of Rain Sound":
  https://haonancheng.cn/attaches/2019%20SIGGRAPH.pdf
- Beacham et al., "Sound generation by water drop impact on surfaces":
  https://doi.org/10.1016/j.expthermflusci.2020.110034
- Rain by ezwa (public domain):
  https://commons.wikimedia.org/wiki/File:Rain_(1).ogg

Web版にはlamejs 1.2.1を変更せず同梱しています。ライセンス条件は
`web/LAMEJS-LICENSE.txt`を参照してください。
