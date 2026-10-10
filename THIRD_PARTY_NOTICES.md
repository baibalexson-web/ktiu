# Сторонние компоненты

## Mozilla PDF.js 4.10.38

Встроен в `vendor/pdfjs/`: `pdf.mjs`, `pdf.worker.mjs` и стандартные шрифты. Исходный проект: https://github.com/mozilla/pdf.js . Документация: https://mozilla.github.io/pdf.js/ .

PDF.js распространяется по Apache License 2.0. Полный текст и уведомления сохранены в `vendor/pdfjs/LICENSE` и заголовках файлов. Это внешняя библиотека чтения PDF; её файлы не следует удалять.

## Стандартные шрифты

- Foxit / PDFium: `vendor/pdfjs/standard_fonts/Foxit*.pfb`. Copyright 2014 PDFium Authors. Лицензия с тремя условиями BSD сохранена полностью в `LICENSE_FOXIT` рядом со шрифтами.
- Liberation Sans: `vendor/pdfjs/standard_fonts/LiberationSans-*.ttf`. Copyright Google Corporation / Red Hat, Inc. SIL Open Font License 1.1; полный текст и имена зарезервированных шрифтов сохранены в `LICENSE_LIBERATION`.

## Зависимости разработки

`jsdom` 26.1.0 используется только для DOM-тестов; MIT License, проект https://github.com/jsdom/jsdom . Его зависимости и их лицензии устанавливаются через `npm ci` по `package-lock.json`. Они не включены в архив и не требуются для запуска приложения.

## Данные и обозначения

Встроенные PDF — опубликованные документы АГАТУ, адреса и контрольные суммы перечислены в `data/manifest.json`. Более ранние документы в `tests/fixtures/` служат контрольными примерами. Логотип взят из ранее предоставленного архива расписания. Название, логотип и документы не объявляются собственностью разработчика этой версии приложения. Приложение не является официальной системой АГАТУ.
