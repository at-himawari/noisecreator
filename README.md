# Rain sound generator

外部の録音素材を使わず、自然なステレオ雨音を MP3 ファイルとして生成するPython 3用
コマンドです。音声合成にはPython標準ライブラリ、MP3エンコードにはFFmpegを使用します。
生成中のメモリ使用量は長さにほぼ依存しないため、長時間の音声も作成できます。

## 使い方

macOS のターミナルで次のように実行します。

```sh
# FFmpegが未導入の場合（初回のみ）
brew install ffmpeg

# 30秒（出力: rain.mp3）
python3 rain.py 30

# 2分30秒、やや強い雨
python3 rain.py 2.5m --intensity 0.8 --output heavy-rain.mp3

# 毎回同じ音を生成する
python3 rain.py 60s --seed 1234 --output rain-60s.mp3
```

## Webブラウザで生成・再生

Finderで `web/index.html` をダブルクリックするか、macOSのターミナルで次を実行します。

```sh
open web/index.html
```

PythonやWebサーバーは不要です。雨音の合成とMP3エンコードはすべてブラウザ内で行われ、
音声データが外部へ送信されることはありません。画面上で長さと雨量を選び、生成したMP3を
そのまま再生または保存できます。「連続モード」を有効にすると、停止ボタンを押すまで
ブラウザ内で雨音を再生し続けます。

`duration` は `30`、`30s`（秒）、`2.5m`（分）、`500ms`（ミリ秒）を受け付けます。
指定可能な長さは24時間までです。`--intensity` は `0`（小雨）から `1`（強い雨）の
範囲です。

```sh
python3 -m unittest -v
```

## 音の構成とデータソース

外部の雨音素材は使用せず、広帯域ノイズ、低域ノイズ、左右で異なるノイズ成分、ポアソン過程で
発生する小粒・中粒・大粒、数秒単位の雨量変動を合成します。雨滴は発振器ではなく短いノイズ
バーストを主体とし、44.1 kHz・2チャンネル・192 kbpsのMP3に書き出します。

連続モードはWeb Audio APIのバンドパス／ローパスフィルターを通した2種類のノイズ床へ、
ランダムなステレオ雨滴を重ねます。雨量スライダーは背景音量と雨滴の発生頻度を変更し、小雨域
では背景を抑えて間隔の空いた小粒・中粒を前面に出します。

実装に利用した標準ライブラリの仕様:

- Python `wave`: https://docs.python.org/3/library/wave.html
- Python `random`: https://docs.python.org/3/library/random.html
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
