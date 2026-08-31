import { test, expect } from 'vitest';

import { Parser } from '../gcode-parser';
import { Thumbnail } from '../thumbnail';

const gcodeCommentsWithThumbnail = `
; thumbnail begin 16x16 856
; iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAACSElEQVR4AXVSW08TURDuHyHSG9vunS
; 21LaX0okiRQq1tipegwSAQQdNoG1ZBGogBJUo0GIiisIlN2sSEB+KDJvgiMSY+uIn8kf0Hw5mT7LIt
; 9GHOmTnnzPfNd2YcHMcN8DyfFgQhw7Js0vTNOBeVyh9uBY/zMVk9796BDoLgbl6aoPPDinY4E4I/j6
; LUno4EasW4olZzIbrjG0c75umUoO3fVeBgImABoP0txUBNuaBxJwAUABdRFK+ZibgvjAbr+Hhl0AvV
; K94mgO08D3s3JNifCEKvyJQc9pLNKiaTvHZwrwfWrjKwdZ2niUezEdgY9cNUuAP+z6fgXzkOfbJfPR
; egX/aV1KQLdsdEi3V5sAumSfJyuosCfJ+JnEqwa8c4obBqOeGEJ3EnrJIqkHU9w8Dzyx4LYDUr6VYX
; 0LG3c6cowlaOgx/3L8Lj/k542HcB3mVZqBDQT2MS6JUkRCVf2eqCvX0beeUYmV5nfLA2xFgALwgzAj
; TGFVgk9+Z7hzkDaOs5Wd8tCvCesO8R/egjAAJ+uSmRf/DCIdGe7vbUmgYJHdT0mSSgLZGESsprfCzw
; UB3wUIBvkyHj51zMeDbSUzP/CttPP3ElI+jI+OtBGN5keePVMEOrmAp1wMsMZ7wl+jdJnJbdmr1bVA
; IG+Pj3XC/Ub8uUaYcwL1xyw9fxbnIeAQRIie4m5iYJYdG/uF0QaRJWgXY0GyZDxMGQ4qm1TuoZADwI
; 8oxaCHTqDcK6mWNhiWhP8E6tNaEtgHkQF1z1hOCut0tojU8AXkBuxgoBg+8AAAAASUVORK5CYII=
; thumbnail end`;

const encodedImg = `iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAACSElEQVR4AXVSW08TURDuHyHSG9vunS21LaX0okiRQq1tipegwSAQQdNoG1ZBGogBJUo0GIiisIlN2sSEB+KDJvgiMSY+uIn8kf0Hw5mT7LIt9GHOmTnnzPfNd2YcHMcN8DyfFgQhw7Js0vTNOBeVyh9uBY/zMVk9796BDoLgbl6aoPPDinY4E4I/j6LUno4EasW4olZzIbrjG0c75umUoO3fVeBgImABoP0txUBNuaBxJwAUABdRFK+ZibgvjAbr+Hhl0AvVK94mgO08D3s3JNifCEKvyJQc9pLNKiaTvHZwrwfWrjKwdZ2niUezEdgY9cNUuAP+z6fgXzkOfbJfPRegX/aV1KQLdsdEi3V5sAumSfJyuosCfJ+JnEqwa8c4obBqOeGEJ3EnrJIqkHU9w8Dzyx4LYDUr6VYX0LG3c6cowlaOgx/3L8Lj/k542HcB3mVZqBDQT2MS6JUkRCVf2eqCvX0beeUYmV5nfLA2xFgALwgzAjTGFVgk9+Z7hzkDaOs5Wd8tCvCesO8R/egjAAJ+uSmRf/DCIdGe7vbUmgYJHdT0mSSgLZGESsprfCzwUB3wUIBvkyHj51zMeDbSUzP/CttPP3ElI+jI+OtBGN5keePVMEOrmAp1wMsMZ7wl+jdJnJbdmr1bVAIG+Pj3XC/Ub8uUaYcwL1xyw9fxbnIeAQRIie4m5iYJYdG/uF0QaRJWgXY0GyZDxMGQ4qm1TuoZADwI8oxaCHTqDcK6mWNhiWhP8E6tNaEtgHkQF1z1hOCut0tojU8AXkBuxgoBg+8AAAAASUVORK5CYII=`;

test('correct base64 image should be valid', () => {
  const thumb = new Thumbnail();
  thumb.chars = encodedImg;
  thumb.charLength = encodedImg.length;
  expect(thumb.isValid).toBeTruthy();
});

test('incorrect base64 image should be invalid', () => {
  const thumb = new Thumbnail();
  thumb.chars = encodedImg.slice(0, -1);
  thumb.charLength = encodedImg.length;
  expect(thumb.isValid).toBeFalsy();
});

test('not matching size should be invalid', () => {
  const thumb = new Thumbnail();
  thumb.chars = encodedImg;
  thumb.charLength = encodedImg.length + 1;
  expect(thumb.isValid).toBeFalsy();
});

test('src should be a jpeg data URL of the base64 chars', () => {
  const thumb = new Thumbnail('16x16', 16, 16, encodedImg.length);
  thumb.chars = encodedImg;
  expect(thumb.src).toEqual('data:image/jpeg;base64,' + encodedImg);
});

test('well-formatted thumbnail should be parsed', () => {
  const parser = new Parser(0);
  const parsed = parser.parseGCode(gcodeCommentsWithThumbnail);

  expect(parsed).not.toBeNull();
  expect(parsed.metadata).not.toBeNull();
  expect(parsed.metadata.thumbnails).not.toBeNull();
  expect(Object.keys(parsed.metadata.thumbnails).length).toEqual(1);
});

test('no thumbnail should be parsed if none present', () => {
  const parser = new Parser(0);
  const parsed = parser.parseGCode('; no thumbnail');

  expect(Object.keys(parsed.metadata.thumbnails).length).toEqual(0);
});

test('thumbnail with incorrect size should be ignored', () => {
  const parser = new Parser(0);
  const parsed = parser.parseGCode(gcodeCommentsWithThumbnail.replace('856', '857'));

  expect(Object.keys(parsed.metadata.thumbnails).length).toEqual(0);
});

test('no thumbnail should be parsed if "end thumbnail" is missing', () => {
  const parser = new Parser(0);
  const parts = gcodeCommentsWithThumbnail.split(';');
  parts.pop();
  const parsed = parser.parseGCode(parts.join(';'));

  expect(Object.keys(parsed.metadata.thumbnails).length).toEqual(0);
});

test('only 1 thumbnail should be parsed if "end thumbnail" is missing for the first but not the second', () => {
  const parser = new Parser(0);
  const parts = gcodeCommentsWithThumbnail.split(';');
  parts.pop();
  const parts2 = gcodeCommentsWithThumbnail.split(';');
  parts.push(...parts2);
  const parsed = parser.parseGCode(parts.join(';'));

  expect(parsed).not.toBeNull();
  expect(parsed.metadata.thumbnails).not.toBeNull();
  expect(Object.keys(parsed.metadata.thumbnails).length).toEqual(1);
  const secondThumb = Object.values(parsed.metadata.thumbnails)[0] as Thumbnail;
  expect(secondThumb.charLength).toEqual(secondThumb.chars.length);
});

test('skip thumb if not base64', () => {
  const parser = new Parser(0);
  const gcodeWithIllegalBase64 =
    `
  ; thumbnail begin 16x16 123
  ; ` +
    encodedImg.slice(0, -1) +
    `
  ; thumbnail end`;
  const parsed = parser.parseGCode(gcodeWithIllegalBase64);

  expect(Object.keys(parsed.metadata.thumbnails).length).toEqual(0);
});
