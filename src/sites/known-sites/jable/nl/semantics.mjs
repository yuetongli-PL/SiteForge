const JABLE_TRADITIONAL_TO_SIMPLIFIED = new Map([
  ['绲?', '涓?'], ['閬?', '杩?'], ['瑗?', '琚?'], ['閬?', '杩?'], ['瑁?', '瑁?'], ['閺?', '闀?'], ['鐛?', '鍏?'],
  ['婕?', '娓?'], ['绱?', '绾?'], ['鍍?', '浠?'], ['甯?', '甯?'], ['榛?', '鐐?'], ['闆?', '鐢?'], ['铏?', '澶?'],
  ['鐛?', '鐙?'], ['婧?', '娓?'], ['鍦?', '鍥?'], ['鏇?', '涔?'], ['椁?', '棣?'], ['椤?', '棰?'], ['鑵?', '鑴?'],
  ['棰?', '椋?'], ['閱?', '鍖?'], ['璀?', '鎶?'], ['闅?', '闃?'], ['缍?', '缁?'], ['灞?', '灞?'], ['璨?', '璐?'],
  ['寰?', '澶?'], ['榻?', '榫?'], ['钘?', '鑽?'], ['楂?', '浣?'], ['璨?', '璐?'], ['绱?', '绾?'], ['楂?', '鍙?'],
  ['瑾?', '璋?'], ['缍?', '鎹?'], ['鍔?', '鍓?'], ['濠?', '濡?'], ['鍎?', '浼?'], ['钘?', '鑹?'], ['瑕?', '瑙?'],
]);

const JABLE_SIMPLIFIED_TO_TRADITIONAL = new Map(
  [...JABLE_TRADITIONAL_TO_SIMPLIFIED.entries()].map(([traditional, simplified]) => [simplified, traditional]),
);

function mapCharacters(value, mapping) {
  return [...String(value ?? '')].map((char) => mapping.get(char) ?? char).join('');
}

function buildJableTargetAliases(label, scopeType = 'tag', cleanDisplayText) {
  const base = cleanDisplayText(String(label ?? '').replace(/^#+/u, ''));
  if (!base) {
    return [];
  }
  const aliases = new Set([base]);
  if (scopeType === 'tag') {
    aliases.add(`#${base}`);
    aliases.add(`${base}鏍囩`);
    aliases.add(`${base}鍒嗙被`);
    aliases.add(`${base}鍒嗛`);
  } else if (scopeType === 'group') {
    aliases.add(`${base}鍒嗙被`);
    aliases.add(`${base}鍒嗛`);
    aliases.add(`鎸?${base}`);
  }
  const simplified = cleanDisplayText(mapCharacters(base, JABLE_TRADITIONAL_TO_SIMPLIFIED));
  const traditional = cleanDisplayText(mapCharacters(base, JABLE_SIMPLIFIED_TO_TRADITIONAL));
  for (const variant of [simplified, traditional]) {
    if (!variant || variant === base) {
      continue;
    }
    aliases.add(variant);
    if (scopeType === 'tag') {
      aliases.add(`#${variant}`);
      aliases.add(`${variant}鏍囩`);
      aliases.add(`${variant}鍒嗙被`);
      aliases.add(`${variant}鍒嗛`);
    } else if (scopeType === 'group') {
      aliases.add(`${variant}鍒嗙被`);
      aliases.add(`${variant}鍒嗛`);
      aliases.add(`鎸?${variant}`);
    }
  }
  if (/^cosplay$/iu.test(base)) {
    aliases.add('Cosplay');
    aliases.add('cosplay');
    aliases.add('#Cosplay');
    aliases.add('#cosplay');
    aliases.add('Cosplay鏍囩');
  }
  return [...aliases].filter(Boolean);
}

export function createJableNlSemantics(deps) {
  const {
    INTENT_LANGUAGE_LABELS,
    ELEMENT_KIND_LABELS,
    ZH_STATUS_QUERY_EXAMPLES,
    createSha256,
    cleanDisplayText,
    ZH_SEARCH_VERBS,
    ZH_OPEN_VERBS,
  } = deps;

  return {
    siteKey: 'jable',
    intentLabels: {
      ...INTENT_LANGUAGE_LABELS,
      'search-video': {
        canonical: '鎼滅储褰辩墖',
        aliases: ['鎼滅储褰辩墖', '鎼滅储瑙嗛', '鏌ユ壘褰辩墖', '鎼滅储鐣彿', '鎼滅暘鍙?', '鎵惧奖鐗?'],
      },
      'open-video': {
        canonical: '鎵撳紑褰辩墖',
        aliases: ['鎵撳紑褰辩墖', '鏌ョ湅褰辩墖', '鎵撳紑瑙嗛', '鏌ョ湅瑙嗛', '鎵撳紑鐣彿', '杩涘叆褰辩墖'],
      },
      'open-model': {
        canonical: '鎵撳紑婕斿憳椤?',
        aliases: ['鎵撳紑婕斿憳椤?', '鏌ョ湅婕斿憳椤?', '鎵撳紑濂冲劒椤?', '鏌ョ湅濂冲劒椤?', '鎵撳紑妯＄壒椤?'],
      },
      'open-category': {
        canonical: '鎵撳紑鍒嗙被椤?',
        aliases: ['鎵撳紑鍒嗙被', '鏌ョ湅鍒嗙被', '鎵撳紑鏍囩', '鏌ョ湅鏍囩', '鎵撳紑鐑棬', '鏌ョ湅鐑棬', '鎵撳紑鏈€鏂版洿鏂?', '鏌ョ湅鏈€鏂版洿鏂?', '鎵撳紑婕斿憳鍒楄〃', '鏌ョ湅婕斿憳鍒楄〃'],
      },
      'list-category-videos': {
        canonical: '鍒嗙被姒滃崟鏌ヨ',
        aliases: [
          '鍒嗙被姒滃崟鏌ヨ',
          '鏍囩姒滃崟鏌ヨ',
          '鍒嗙被鎺ㄨ崘',
          '鏍囩鎺ㄨ崘',
          '鍒嗙被鍓嶅嚑鏉?',
          '鏍囩鍓嶅嚑鏉?',
          '杩戞湡鏈€浣虫帹鑽?',
          '鏈€杩戞洿鏂板墠鍑犳潯',
          '鏈€澶氳鐪嬪墠鍑犳潯',
          '鏈€楂樻敹钘忓墠鍑犳潯',
        ],
      },
    },
    elementLabels: {
      ...ELEMENT_KIND_LABELS,
      'content-link-group': {
        canonical: '褰辩墖',
        aliases: ['褰辩墖', '瑙嗛', '鐣彿', '褰辩墖璇︽儏', '瑙嗛椤?'],
      },
      'author-link-group': {
        canonical: '婕斿憳',
        aliases: ['婕斿憳', '濂冲劒', '妯＄壒', '婕斿憳椤?', '濂冲劒椤?'],
      },
      'search-form-group': {
        canonical: '鎼滅储褰辩墖',
        aliases: ['鎼滅储褰辩墖', '鎼滅储瑙嗛', '鎼滅暘鍙?', '鎼滅储'],
      },
      'category-link-group': {
        canonical: '鍒嗙被鍒楄〃',
        aliases: ['鍒嗙被', '鍒嗙被椤?', '鏍囩', '鏍囩椤?', '鐑棬', '鏈€鏂版洿鏂?', '婕斿憳鍒楄〃', '鎼滅储缁撴灉'],
      },
      'utility-link-group': {
        canonical: '鍔熻兘椤?',
        aliases: ['鍔熻兘椤?', '鎼滅储椤?'],
      },
    },
    statusExamples: {
      ...ZH_STATUS_QUERY_EXAMPLES,
      'category-link-group': ['褰撳墠鎵撳紑鐨勬槸鍝釜鍒嗙被椤?', '鐜板湪鏄湪鏍囩椤佃繕鏄儹闂ㄩ〉', '褰撳墠鏄湪婕斿憳鍒楄〃杩樻槸鏈€鏂版洿鏂?'],
      'content-link-group': ['褰撳墠鎵撳紑鐨勬槸鍝儴褰辩墖', '鐜板湪鍦ㄧ湅鍝釜鐣彿', '褰撳墠椤垫槸鍝儴瑙嗛璇︽儏'],
      'author-link-group': ['褰撳墠鎵撳紑鐨勬槸鍝釜婕斿憳椤?', '鐜板湪鍦ㄧ湅鍝釜濂冲劒', '褰撳墠椤垫槸鍝綅婕斿憳璇︽儏'],
      'search-form-group': ['褰撳墠鎼滅储鐨勬槸鍝儴褰辩墖', '鐜板湪鐨勬悳绱㈣瘝鏄粈涔?', '鐜板湪妫€绱㈢殑鏄摢涓暘鍙?'],
    },
    searchQueryNouns: ['褰辩墖', '瑙嗛', '鐣彿', '婕斿憳', '濂冲劒', '鍒嗙被', '鏍囩', '鐑棬', '鏈€鏂版洿鏂?'],
    searchVerbTerms: [...ZH_SEARCH_VERBS, '鎼滅储褰辩墖', '鎼滅储瑙嗛', '鎼滅储鐣彿', '鏌ユ壘褰辩墖', '鏌ユ壘瑙嗛', '鎼滅暘鍙?'],
    openVerbTerms: [...ZH_OPEN_VERBS, '鎵撳紑褰辩墖', '鏌ョ湅褰辩墖', '鎵撳紑瑙嗛', '鏌ョ湅瑙嗛', '鎵撳紑婕斿憳椤?', '鏌ョ湅婕斿憳', '鎵撳紑濂冲劒椤?', '鏌ョ湅濂冲劒'],
    clarificationRules: [
      {
        clarificationRuleId: `clar_${createSha256('jable-category-target-unknown').slice(0, 12)}`,
        case: 'category-target-unknown',
        when: { match: 'jable-taxonomy-target-not-found' },
        response: {
          mode: 'ask',
          questionTemplate: '杩欎釜鍒嗙被鎴栨爣绛惧綋鍓嶄笉鍦ㄥ凡鎶藉彇 taxonomy 閲屻€傝涓嶈鎹㈡垚鏇存帴杩戠殑宸茬煡鏍囩鎴栦竴绾у垎绫荤粍锛?',
          candidateLimit: 8,
          candidateSource: 'observed-values',
        },
        recovery: {
          expectedSlot: 'targetMemberId',
          resumeMode: 're-run-entry-rules',
        },
      },
    ],
    targetAliases(label, scopeType = 'tag') {
      return buildJableTargetAliases(label, scopeType, cleanDisplayText);
    },
    buildGeneratedPatternExamples(context, patternType, fallbackValues) {
      if (context.slotName === 'queryText') {
        return fallbackValues.map((valueRecord) => {
          const label = valueRecord.label ?? String(valueRecord.value);
          if (context.intent.intentType === 'search-video') {
            return patternType === 'explicit-intent' ? `鎼滅储褰辩墖${label}` : label;
          }
          return patternType === 'explicit-intent' ? `鎼滅储${label}` : label;
        });
      }
      if (context.intent.intentType === 'list-category-videos') {
        return fallbackValues.map((valueRecord, index) => {
          const label = valueRecord.label ?? String(valueRecord.value);
          const examples = [
            `${label}鍒嗙被锛岃繎鏈熸渶浣虫帹鑽愪笁閮?`,
            `${label}鏍囩鏈€杩戞洿鏂板墠浜旀潯`,
            `${label}鏈€楂樻敹钘忓墠涓?`,
          ];
          return patternType === 'explicit-intent' ? examples[index % examples.length] : label;
        });
      }
      return fallbackValues.map((valueRecord) => {
        const label = valueRecord.label ?? String(valueRecord.value);
        if (context.intent.intentType === 'open-model') {
          return patternType === 'explicit-intent' ? `鎵撳紑婕斿憳椤?${label}` : label;
        }
        if (context.intent.intentType === 'open-video') {
          return patternType === 'explicit-intent' ? `鎵撳紑褰辩墖${label}` : label;
        }
        if (context.intent.intentType === 'search-video') {
          return patternType === 'explicit-intent' ? `鎼滅储褰辩墖${label}` : label;
        }
        return null;
      }).filter(Boolean);
    },
    rewriteClarificationRule(cloned) {
      if (cloned.case === 'missing-slot') {
        cloned.response.questionTemplate = '浣犺鎵惧摢閮ㄥ奖鐗囨垨鍝釜婕斿憳锛熸垜鍙互鍒楀嚭褰撳墠鏈夊姩浣滆瘉鎹殑鍊欓€夐」銆?';
      } else if (cloned.case === 'ambiguous-target') {
        cloned.response.questionTemplate = '杩欎釜璇存硶鍙兘瀵瑰簲澶氶儴褰辩墖鎴栧涓紨鍛橈紝璇风粰鎴戞洿鍏蜂綋鐨勭暘鍙枫€佺墖鍚嶆垨婕斿憳鍚嶃€?';
      } else if (cloned.case === 'unsupported-target') {
        cloned.response.questionTemplate = '杩欎釜褰辩墖鎴栨紨鍛樺彲浠ヨ瘑鍒紝浣嗗綋鍓嶆病鏈夊彲鎵ц鐨勫姩浣滆瘉鎹€傝涓嶈鎹竴涓凡瑙傚療鍒板彲鎵撳紑鐨勭洰鏍囷紵';
      } else if (cloned.case === 'search-no-results') {
        cloned.response.questionTemplate = '绔欏唴娌℃湁鍛戒腑璇ュ奖鐗囩粨鏋滐紝鍙互鎹竴涓洿鍏蜂綋鐨勭暘鍙枫€佺墖鍚嶆垨婕斿憳鍚嶇户缁悳绱€?';
      }
      return cloned;
    },
  };
}
