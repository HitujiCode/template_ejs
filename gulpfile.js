// ==================================================
// 基本モジュール
// ==================================================
import gulp from "gulp";
const { series, parallel, src, dest, watch } = gulp;

import plumber from "gulp-plumber";
import notify from "gulp-notify";
import browserSync from "browser-sync";

// ==================================================
// Sass関連
// ==================================================
import * as dartSass from "sass";
import gulpSass from "gulp-sass";
import sassGlob from "gulp-sass-glob-use-forward";
import postcss from "gulp-postcss";
import autoprefixer from "autoprefixer";
import postcssSortMediaQueries from "postcss-sort-media-queries";
import cssdeclsort from "css-declaration-sorter";
const sass = gulpSass(dartSass);

// ==================================================
// EJS関連
// ==================================================
import * as ejsCompiler from "ejs";
import replace from "gulp-replace";
import htmlbeautify from "gulp-html-beautify";
import fs from "fs";
import rename from "gulp-rename";

// ==================================================
// 画像処理（sharp / imagemin）
// ==================================================
import sharp from "sharp";
import through2 from "through2";
import path from "path";
import imagemin from "imagemin";
import imageminSvgo from "imagemin-svgo";

// ==================================================
// ユーティリティ
// ==================================================
import changed from "gulp-changed";
import { deleteAsync } from "del";

// ==================================================
// パス設定
// ==================================================
const srcPath = {
  css: "./src/sass/**/*.scss",
  js: "./src/js/**/*.js",
  ejs: ["./src/ejs/**/*.ejs", "!./src/ejs/**/_*.ejs"],
  ejsWatch: "./src/ejs/**/*.ejs",
  jsonWatch: "./src/ejs/data/**/*.json",
  img: "./src/images/**/*.{jpg,jpeg,png,svg}",
  imgRaster: "./src/images/**/*.{jpg,jpeg,png}",
  imgSvg: "./src/images/**/*.svg",
};

const destPath = {
  all: "./dist",
  css: "./dist/assets/css/",
  js: "./dist/assets/js/",
  html: "./dist/",
  img: "./dist/assets/images/",
};

// ==================================================
// Sassコンパイル
// ==================================================
function css() {
  return src(srcPath.css)
    .pipe(plumber({ errorHandler: notify.onError("[SASS ERROR] <%= error.message %>") }))
    .pipe(sassGlob())
    .pipe(sass().on("error", sass.logError))
    .pipe(postcss([
      autoprefixer({ overrideBrowserslist: ['defaults', 'not op_mini all'] }),
      postcssSortMediaQueries(),
      cssdeclsort({ order: "smacss" })
    ]))
    .pipe(dest(destPath.css))
    .pipe(browserSync.stream());
}

// ==================================================
// JSコピー（圧縮なし）
// ==================================================
function js() {
  return src(srcPath.js)
    .pipe(dest(destPath.js));
}

// ==================================================
// EJSコンパイル用 JSON一括読み込み関数
// ==================================================
function loadJsonData(dir = './src/ejs/data') {
  const files = fs.readdirSync(dir).filter(file => file.endsWith('.json'));
  const data = {};

  files.forEach(file => {
    const key = path.basename(file, '.json');
    const content = fs.readFileSync(path.join(dir, file), 'utf8');
    data[key] = JSON.parse(content);
  });

  return data;
}

// ==================================================
// EJSコンパイル（複数JSON対応）
// ==================================================
function ejsCompile() {
  const json = loadJsonData();

  return src(srcPath.ejs)
    .pipe(plumber({ errorHandler: notify.onError("[EJS ERROR] <%= error.message %>") }))
    .pipe(
      through2.obj(function (file, _, cb) {
        const fileName = path.basename(file.path, '.ejs');
        const pageDataKey = fileName === 'index' ? 'top' : fileName;

        try {
          const template = ejsCompiler.compile(file.contents.toString(), {
            filename: file.path, // インクルードの相対パスを有効にする
          });

          const html = template({
            baseUrlPath: '.',
            ejsPath: '.',
            page: json,
          });

          file.contents = Buffer.from(html);
          cb(null, file);
        } catch (err) {
          cb(err);
        }
      })
    )
    .pipe(rename({ extname: ".html" }))
    .pipe(replace(/^[ \t]*\n/gm, "")) // 空行削除
    .pipe(htmlbeautify({
      indent_size: 2,
      indent_char: " ",
      max_preserve_newlines: 0,
      preserve_newlines: false,
      extra_liners: [],
    }))
    .pipe(dest(destPath.html))
    .on("end", browserSync.reload);
}

// ==================================================
// 画像圧縮（JPEG/PNG）
// ==================================================
function compressImages() {
  return src(srcPath.imgRaster, { encoding: false })
    .pipe(changed(destPath.img)) // 変更があった画像のみ処理
    .pipe(
      through2.obj(async (file, _, cb) => {
        if (file.isBuffer()) {
          try {
            const ext = path.extname(file.path).toLowerCase();
            let outputBuffer;

            if (ext === '.jpg' || ext === '.jpeg') {
              outputBuffer = await sharp(file.contents).jpeg({ quality: 75 }).toBuffer();
            } else if (ext === '.png') {
              outputBuffer = await sharp(file.contents).png({ quality: 75 }).toBuffer();
            }

            file.contents = outputBuffer;
            cb(null, file);
          } catch (err) {
            cb(err);
          }
        } else {
          cb(null, file);
        }
      })
    )
    .pipe(dest(destPath.img));
}

// ==================================================
// AVIF変換（JPEG/PNG）
// ==================================================
function convertToAvif() {
  return src(srcPath.imgRaster, { encoding: false })
    .pipe(changed(destPath.img, { extension: '.avif' })) // AVIF変換済みがないものだけ
    .pipe(
      through2.obj(async (file, _, cb) => {
        if (file.isBuffer()) {
          try {
            const outputBuffer = await sharp(file.contents).avif({ quality: 75 }).toBuffer();
            const avifFile = file.clone();
            avifFile.path = file.path.replace(/\.(jpg|jpeg|png)$/i, ".avif");
            avifFile.contents = outputBuffer;
            cb(null, avifFile);
          } catch (err) {
            cb(err);
          }
        } else {
          cb(null, file);
        }
      })
    )
    .pipe(dest(destPath.img));
}

// ==================================================
// SVG圧縮（SVGO）
// 修正: imagemin.buffer の戻り値が Buffer 以外の場合に対応
// ==================================================
function compressSVG() {
  return src(srcPath.imgSvg)
    .pipe(changed(destPath.img))
    .pipe(
      through2.obj(async (file, _, cb) => {
        if (file.isBuffer()) {
          try {
            let outputBuffer = await imagemin.buffer(file.contents, {
              plugins: [
                imageminSvgo({
                  plugins: [
                    {
                      name: 'preset-default',
                      params: {
                        overrides: {
                          removeViewBox: true,
                        }
                      }
                    },
                    { name: 'removeDimensions', active: true }
                  ]
                })
              ]
            });

            // 出力が Uint8Array であれば Buffer に変換
            if (outputBuffer instanceof Uint8Array) {
              outputBuffer = Buffer.from(outputBuffer);
            }
            // Buffer でなければ文字列として変換して Buffer 化
            else if (!Buffer.isBuffer(outputBuffer)) {
              outputBuffer = Buffer.from(String(outputBuffer));
            }
            file.contents = outputBuffer;
            cb(null, file);
          } catch (err) {
            cb(err);
          }
        } else {
          cb(null, file);
        }
      })
    )
    .pipe(dest(destPath.img));
}

// ==================================================
// ローカルサーバー起動
// ==================================================
function serve(done) {
  browserSync.init({
    server: { baseDir: destPath.html },
    notify: false,
  });
  done();
}

// ==================================================
// クリーン（dist削除）
// ==================================================
const clean = () => deleteAsync(['./dist'], { force: true });
export { clean };

// ==================================================
// ファイル監視
// ==================================================
function watchFiles() {
  watch(srcPath.css, css);
  watch(srcPath.js, js);
  watch(srcPath.ejsWatch, ejsCompile);
  watch(srcPath.jsonWatch, ejsCompile);
  watch(srcPath.imgRaster, parallel(compressImages, convertToAvif));
  watch(srcPath.imgSvg, compressSVG);
}

// ==================================================
// タスク定義
// ==================================================
export const defaultTask = series(
  parallel(css, js, ejsCompile, compressImages, convertToAvif, compressSVG),
  serve,
  watchFiles
);

export default defaultTask;

export const build = series(
  clean,
  css,
  js,
  ejsCompile,
  compressImages,
  convertToAvif,
  compressSVG
);
