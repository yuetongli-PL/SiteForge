import { BIQU_22_SITE_RENDERER } from './sites/22biqu.mjs';
import { BILIBILI_SITE_RENDERER } from './sites/bilibili.mjs';
import { DOUYIN_SITE_RENDERER } from './sites/douyin.mjs';
import { JABLE_SITE_RENDERER } from './sites/jable.mjs';
import { MOODYZ_SITE_RENDERER } from './sites/moodyz.mjs';

export const KNOWN_SITE_RENDERERS = Object.freeze({
  moodyz: MOODYZ_SITE_RENDERER,
  jable: JABLE_SITE_RENDERER,
  '22biqu': BIQU_22_SITE_RENDERER,
  bilibili: BILIBILI_SITE_RENDERER,
  douyin: DOUYIN_SITE_RENDERER,
});
