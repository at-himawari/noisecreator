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

PythonやWebサーバーは不要です。実録素材の長さ・密度調整とMP3エンコードはすべてブラウザ内で行われ、
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

Wikimedia Commonsで公開されている45秒の実録雨音を遠景の基礎素材にしています。指定時間に
合わせた2.8秒の等電力クロスフェードに加え、4〜13秒間隔で滑らかに変わる非周期の雨量、
ポアソン過程で発生する小粒・中粒・低頻度の大粒を重ねます。各雨粒は音量・周波数・減衰時間・
ステレオ位置を個別に変え、44.1 kHz・2チャンネル・192 kbpsのMP3に書き出します。

連続モードでは、開始位置の異なる実録レイヤーに滑らかな雨量変動を与えています。録音素材の
再生速度は変化させず、ピッチの揺れが発生しないようにしています。

雨量スライダーは、背景音量だけでなく、重ねる実録レイヤーの密度と個別雨粒の発生頻度を変更
します。小雨域では背景を抑え、間隔の空いた小粒・中粒を前面に出します。ユーザーが指定する
雨量と、数秒単位の自然な音量変動は独立したゲインで処理します。

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
