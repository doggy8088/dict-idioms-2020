#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence


ROOT = Path(__file__).resolve().parents[1]
JSON_PATH = ROOT / "dict_idioms_2020_20260324.json"
TEMPLATE_PATH = ROOT / "images" / "idiom-image-meta-prompt-template.md"
TODO_PATH = ROOT / "images" / "prompt_todo.md"
PROMPT_DIR = ROOT / "images" / "prompts"


TODO_LINE_RE = re.compile(r"^- \[[ xX]\] (\d+)\. ([^：]+)：")
MULTI_SPLIT_RE = re.compile(r"[／/]|＆|&|；|;")


@dataclass(frozen=True)
class IdiomEntry:
    id: int
    idiom: str
    meaning: str
    usage_meaning: str
    usage_class: str
    synonyms: str
    antonyms: str
    source_note: str
    main_type: str


def normalize_text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        parts = [normalize_text(item) for item in value]
        parts = [part for part in parts if part]
        return "／".join(parts)
    text = str(value)
    text = text.replace("\u3000", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def normalize_meaning(value: object) -> str:
    if isinstance(value, list):
        if not value:
            return ""
        value = value[0]
    text = normalize_text(value)
    if not text:
        return ""
    text = re.sub(r"\s*△「[^」]+」[。．\.]?", "", text)
    text = re.sub(r"\s*＃語本[^。．\.]+[。．\.]?", "", text)
    text = text.strip(" 。．.、;；")
    return text


def first_meaning_clause(text: str) -> str:
    if not text:
        return ""
    primary = MULTI_SPLIT_RE.split(text, maxsplit=1)[0]
    primary = re.sub(r"[。．.]+$", "", primary).strip()
    return primary


def strip_leading_frame(text: str) -> str:
    patterns = [
        r"^比喻",
        r"^形容",
        r"^指",
        r"^用以",
        r"^用於",
        r"^用在「[^」]+」的表述上",
        r"^用於「[^」]+」的表述上",
    ]
    out = text.strip()
    for pat in patterns:
        out = re.sub(pat, "", out, count=1)
    return out.strip(" ，,。．.;；")


def join_nonempty(items: Iterable[str], sep: str = "、") -> str:
    parts = [normalize_text(item) for item in items]
    parts = [part for part in parts if part]
    return sep.join(parts)


def load_rows() -> list[dict]:
    data = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    rows = data["idioms"]
    rows.sort(key=lambda row: int(row["編號"]))
    return rows


def load_main_entries(rows: Sequence[dict]) -> dict[int, IdiomEntry]:
    main: dict[int, IdiomEntry] = {}
    for row in rows:
        if row.get("主條成語／非主條成語") != "主條成語":
            continue
        entry = IdiomEntry(
            id=int(row["編號"]),
            idiom=normalize_text(row["成語"]),
            meaning=normalize_meaning(row.get("釋義")),
            usage_meaning=normalize_text(row.get("用法說明-語義說明")),
            usage_class=normalize_text(row.get("用法說明-使用類別")),
            synonyms=normalize_text(row.get("近義成語")),
            antonyms=normalize_text(row.get("反義成語")),
            source_note=normalize_text(row.get("典故說明")),
            main_type=normalize_text(row.get("主條成語／非主條成語")),
        )
        main[entry.id] = entry
    return main


def categorize(entry: IdiomEntry) -> dict[str, str]:
    text = " ".join(
        part
        for part in [
            entry.idiom,
            entry.meaning,
            entry.usage_meaning,
            entry.usage_class,
            entry.synonyms,
            entry.antonyms,
        ]
        if part
    )

    def has(*needles: str) -> bool:
        return any(n in text for n in needles)

    category = "generic"
    if has("承諾", "守信", "信用", "誠信", "守約", "失信", "一諾千金", "一言九鼎", "言而有信", "出爾反爾", "毀約"):
        category = "promise"
    elif has("吝", "財", "錢", "鐵公雞", "解囊", "慷慨"):
        category = "stingy"
    elif has("騙", "欺", "偽", "瞞", "掩", "混淆", "是非", "陷害", "造謠", "暗中"):
        category = "deception"
    elif has(
        "學習",
        "理解",
        "領會",
        "舉一反三",
        "不求甚解",
        "胸有成竹",
        "江郎才盡",
        "青出於藍",
        "口若懸河",
        "老馬識途",
        "名落孫山",
        "不學無術",
        "才思",
        "才氣",
        "才華",
        "應試",
        "考試",
        "學",
        "讀",
    ):
        category = "learning"
    elif has("無常", "反覆", "變化", "朝三暮四", "朝秦暮楚", "出爾反爾", "一日千里", "瞬息"):
        category = "change"
    elif has("敗", "失敗", "一敗", "束手", "無計", "窮", "困", "崩", "瓦解", "收拾"):
        category = "failure"
    elif has("驚", "恐", "懼", "怕", "驚弓", "草木皆兵", "心有餘悸"):
        category = "fear"
    elif has("權", "勢", "名聲", "炙手可熱", "顯赫", "紅", "受歡迎", "熱門"):
        category = "status"
    elif has("竹", "成竹", "有定見", "有備", "胸有成竹", "先發"):
        category = "prepared"
    elif has("真相", "澄清", "水落石出", "揭露", "曝光", "事發", "敗露"):
        category = "truth"
    elif has("自大", "狂妄", "夜郎", "目空", "傲慢", "自負", "剛愎"):
        category = "arrogance"
    elif has("低劣", "同樣", "沒有差異", "一丘之貉", "五十步笑百步"):
        category = "similar_low"
    elif has("口若懸河", "能言善辯", "善於言談", "說得天花亂墜"):
        category = "speech"
    elif has("腐", "竭澤", "殺雞取卵", "焚林", "取盡", "不留餘地"):
        category = "drain"
    elif has("對立", "相反", "南轅北轍", "背道而馳", "差異", "相同"):
        category = "contrast"
    elif has("巧", "多此一舉", "畫蛇添足", "弄巧成拙", "班門弄斧", "不自量力"):
        category = "overreach"
    elif has("努力", "堅持", "不撓", "百折", "一鼓作氣", "鍥而不舍"):
        category = "perseverance"
    elif has("合作", "群策", "同心", "協力", "互助"):
        category = "cooperation"
    elif has("人才", "才思", "靈感", "才盡", "江郎才盡"):
        category = "talent"
    elif has("超越", "勝過", "青出於藍", "後來居上"):
        category = "surpass"
    elif has("分辨", "是非", "真假", "似是而非", "矛盾"):
        category = "ambiguity"
    elif has("完美", "無縫", "天衣無縫", "自然"):
        category = "seamless"

    concept_map = {
        "stingy": "自私吝嗇、拒絕付出",
        "promise": "承諾與信用具有重量",
        "deception": "自欺欺人、掩飾真相",
        "learning": "學習吸收不完整、理解表面化",
        "change": "態度或局勢反覆變動",
        "failure": "結果失控、全面崩潰",
        "fear": "受驚後的緊張與過度警戒",
        "status": "權勢炙盛或名聲暴漲",
        "prepared": "事前已建立清楚判斷或完整準備",
        "truth": "隱藏事實被揭開",
        "arrogance": "狂妄自大、見識短淺",
        "similar_low": "彼此同樣低劣、沒有差別",
        "speech": "言談流暢、說話不斷",
        "drain": "把資源一次耗盡、不留後路",
        "contrast": "方向或結果完全相反",
        "overreach": "行事失當、過度賣弄反而弄巧成拙",
        "perseverance": "持續努力、循序推進",
        "cooperation": "多人協作、彼此配合",
        "talent": "靈感枯竭、表現衰退",
        "surpass": "後來居上、超越前人",
        "ambiguity": "表面與實際不一致",
        "seamless": "完整無缺、看不出破綻",
        "generic": strip_leading_frame(first_meaning_clause(entry.usage_meaning or entry.meaning)),
    }

    strategy_map = {
        "stingy": "以緊握不放的手勢與被鎖住的資源形成對照",
        "promise": "以握手、契約或具重量感的承諾物件呈現信用",
        "deception": "以遮掩、錯認或自我欺瞞的畫面隱喻真相被扭曲",
        "learning": "以吸收、分解、拼接或逐步理解的視覺隱喻呈現",
        "change": "以前後差異、切換情境或連續動勢呈現反覆變化",
        "failure": "以崩塌、耗盡或失序場景呈現全面失敗",
        "fear": "以緊繃姿態、放大威脅與過度警覺呈現驚懼",
        "status": "以受矚目、中心聚焦與熱度升高的構圖呈現權勢或聲量",
        "prepared": "以清楚藍圖、內在思路或穩定節奏呈現胸有定見",
        "truth": "以遮蔽被移除、地表顯露或檔案揭開呈現真相大白",
        "arrogance": "以高低落差、誇大比例或孤立位置呈現狂妄與侷限",
        "similar_low": "以成群同質、細節相近的對照呈現沒有差別",
        "speech": "以連續流動的視覺動線呈現話語傾瀉而出",
        "drain": "以資源被快速抽空、環境乾涸的場景呈現不留餘地",
        "contrast": "以兩端相反、路線分岔或方向背離呈現對立",
        "overreach": "以過度操作導致失衡的畫面呈現弄巧成拙",
        "perseverance": "以持續推進、逐步累積或反覆嘗試呈現堅持",
        "cooperation": "以多人協作、互補分工或齊心推進呈現合作",
        "talent": "以創作能量枯竭、工具失效或靈感停滯呈現才盡",
        "surpass": "以新舊對照、高低翻轉或後者超前呈現進步",
        "ambiguity": "以表面相似但細節不同的對照呈現似是而非",
        "seamless": "以無接縫的融合、精密拼合或自然渾成呈現完整感",
        "generic": "以能直接傳達語義的現代視覺隱喻呈現",
    }

    subject_map = {
        "stingy": "一位死守財物的人物、緊抓錢袋或硬幣",
        "promise": "一位守約的人物、握手或簽署契約的雙方",
        "deception": "一位試圖遮掩真相的人物與被誤導的觀者",
        "learning": "正在吸收資訊的學習者、書本或食物隱喻",
        "change": "兩個狀態不同的主要主體、或同一主體在前後變化",
        "failure": "失去支撐的主體、倒塌的場景或受挫的人物",
        "fear": "一隻受驚的鳥、緊張的人物或被誤認的環境",
        "status": "站在中心、被聚光燈照亮的主體",
        "prepared": "冷靜思考的人物、藍圖或已完成的概念草圖",
        "truth": "被露出的石頭、掀開的幕布或解開的遮掩物",
        "arrogance": "高高在上的人物或自我膨脹的角色",
        "similar_low": "一群外觀相近、品質相似的角色或物件",
        "speech": "正在說話的人物、流動的語意線條",
        "drain": "水池、資源庫、森林或被抽空的容器",
        "contrast": "兩條方向相反的路線、車輛或箭頭",
        "overreach": "手忙腳亂的行動者與被弄壞的結果",
        "perseverance": "持續向前的主體、階梯或累積中的成果",
        "cooperation": "多位分工協作的人物或互補的工具",
        "talent": "逐漸枯竭的創作者、乾掉的墨水或空白畫面",
        "surpass": "後輩與前輩的對照主體、向上成長的元素",
        "ambiguity": "看似相似但細節不一致的雙重主體",
        "seamless": "完美接合的布料、拼圖或渾然一體的物件",
        "generic": "能承載寓意的主要主體",
    }

    scene_map = {
        "stingy": "現代室內或簡潔抽象空間，聚焦於手部與財物",
        "promise": "會議桌、簽約桌或握手完成的現代空間",
        "deception": "半遮半掩、光影對照明顯的現代場景",
        "learning": "書桌、講桌、工作台或學習場景",
        "change": "前後對照的雙區或連續場景",
        "failure": "崩落、散架或混亂擴散的空間",
        "fear": "昏暗但可辨識的戶外或緊張環境",
        "status": "被人群關注或被光束聚焦的舞台感場景",
        "prepared": "桌面上攤開草圖、棋局或計畫板的場景",
        "truth": "水位下降、布幕掀開或遮掩解除的場景",
        "arrogance": "高低落差明顯的空間或自我膨脹的舞台",
        "similar_low": "同一片區域內排列相近主體的場景",
        "speech": "近景人物對話場域、延伸成流動線條",
        "drain": "乾涸水域、被清空的容器或耗盡的資源場景",
        "contrast": "道路、箭頭或路線明顯背離的分岔場景",
        "overreach": "操作失衡、過度加工或反效果的工作現場",
        "perseverance": "逐步推進的工作場景或階梯式進展空間",
        "cooperation": "分工合作的工作台、團隊場景或協力機制",
        "talent": "空白畫布、乾涸文具或靈感停滯的創作空間",
        "surpass": "師徒、新舊或前後輩並列的對照場景",
        "ambiguity": "類似圖案或相近形體的對照場景",
        "seamless": "縫合、拼接或渾然成形的精密場景",
        "generic": "以能直接呈現語義的現代化場景",
    }

    relation_map = {
        "stingy": "主體緊抓資源不肯釋出，形成強烈的收與不收對比",
        "promise": "承諾一旦成立就具重量，雙方以穩定的連結互相確認",
        "deception": "主體試圖遮掩，但畫面另一層已顯示真相外露",
        "learning": "主體只吸收表面訊息，或透過分解逐步理解",
        "change": "同一件事在不同時點或狀態下發生切換",
        "failure": "主體失去支撐，結果一路崩潰到底",
        "fear": "主體因過往驚嚇而對微小動靜高度敏感",
        "status": "熱度或權勢集中在主體身上，周圍人物向其聚攏",
        "prepared": "主體內部已有完整判斷，外在行動因而穩定",
        "truth": "遮蔽被移開後，隱藏的結構或真相顯露",
        "arrogance": "主體誇大自我，與實際位置形成落差",
        "similar_low": "多個主體在品質與樣貌上幾乎沒有差別",
        "speech": "話語像水流一樣持續湧出，幾乎停不下來",
        "drain": "資源被一次清空，沒有留給未來的餘裕",
        "contrast": "行動方向與目標完全相背離",
        "overreach": "過度修飾或亂用技巧反而把事情弄壞",
        "perseverance": "主體持續往前累積，靠反覆推進達成結果",
        "cooperation": "多個主體彼此補位，共同完成同一件事",
        "talent": "創作能力或輸出能量逐步枯竭",
        "surpass": "後方主體在表現上逐漸超越前方主體",
        "ambiguity": "外觀相近，實質卻不一致",
        "seamless": "各部分精準銜接，幾乎看不出接縫",
        "generic": "主體、場景與動勢共同指向成語核心語義",
    }

    composition_map = {
        "stingy": "中近景、單一主體偏置，手部細節放大",
        "promise": "雙人近景或中心構圖，強調手勢與契約物件",
        "deception": "左右或前後雙層構圖，讓遮掩與暴露同時可見",
        "learning": "桌面俯視或半俯視，讓理解流程清楚呈現",
        "change": "2x2 四格或左右分區構圖，凸顯前後差異",
        "failure": "由上往下崩落或由中心向外擴散的構圖",
        "fear": "主體偏小、周圍環境放大，強化壓迫感",
        "status": "中心聚焦、放射式視線導引",
        "prepared": "以中心構圖搭配前景草圖與背景推演",
        "truth": "由遮蔽物到顯露物的層次構圖",
        "arrogance": "高低錯位或仰視構圖，突出自我膨脹",
        "similar_low": "橫向排列或群組對照構圖",
        "speech": "近景主體搭配延展出去的流線構圖",
        "drain": "由滿到空、由高到低的流失式構圖",
        "contrast": "雙向分岔或兩端對置構圖",
        "overreach": "局部放大失誤點，讓失衡清楚可見",
        "perseverance": "由左至右或由下至上的推進構圖",
        "cooperation": "多主體圍繞共同任務的環形或協作構圖",
        "talent": "空白留白多、中心只留少量未完成元素",
        "surpass": "前後疊層或高低梯度構圖",
        "ambiguity": "左右對照或近似雙重構圖",
        "seamless": "中央細節放大、邊界隱去的完整構圖",
        "generic": "以單一清楚主體為中心的視覺構圖",
    }

    style_map = {
        "stingy": "現代編輯插畫，線條俐落，色彩克制，重視手部細節與材質對比",
        "promise": "乾淨穩重的現代編輯插畫，重視手勢與契約質感",
        "deception": "概念插畫風，明暗對比強，帶有微妙的戲劇張力",
        "learning": "繪本感插畫，色塊清楚，重點在理解過程與層次",
        "change": "平面設計式插畫，分區明確，色彩節奏感強",
        "failure": "概念藝術風，帶些碎裂與崩解質感",
        "fear": "偏冷色的敘事插畫，光影敏感，氛圍緊繃",
        "status": "高對比的時尚編輯插畫，聚光效果明顯",
        "prepared": "乾淨的概念插畫，線稿清楚，資訊感明確",
        "truth": "清晰的敘事插畫，色彩由濃轉淡，強調揭露感",
        "arrogance": "帶有誇張比例的象徵插畫，視覺語氣直接",
        "similar_low": "整齊排列的圖像設計風，強調重複與差異細節",
        "speech": "流動線條感的插畫風，視覺節奏連續",
        "drain": "略帶乾涸紋理的概念插畫，重視資源消失感",
        "contrast": "雙色對照的平面插畫，方向感非常清楚",
        "overreach": "敘事漫畫感插畫，強調失誤後果",
        "perseverance": "明亮但克制的成長系插畫，節奏穩定",
        "cooperation": "群像式插畫，分工與協同關係清晰",
        "talent": "留白較多的概念插畫，表現枯竭與停滯",
        "surpass": "前後對照的成長插畫，層次分明",
        "ambiguity": "細節導向的對照插畫，讓相似與差異並存",
        "seamless": "精緻紙雕感或無縫概念插畫，線條乾淨",
        "generic": "乾淨的現代插畫，色彩明確、主題清楚",
    }

    return {
        "category": category,
        "關鍵概念": concept_map.get(category, concept_map["generic"]),
        "視覺策略": strategy_map.get(category, strategy_map["generic"]),
        "主要主體": subject_map.get(category, subject_map["generic"]),
        "場景設定": scene_map.get(category, scene_map["generic"]),
        "核心視覺關係": relation_map.get(category, relation_map["generic"]),
        "構圖方式": composition_map.get(category, composition_map["generic"]),
        "視覺風格": style_map.get(category, style_map["generic"]),
    }


def build_template_values(entry: IdiomEntry) -> dict[str, str]:
    category_pack = categorize(entry)
    semantic = first_meaning_clause(entry.usage_meaning or entry.meaning)
    semantic = semantic or entry.meaning
    semantic = strip_leading_frame(semantic)
    if not semantic:
        semantic = entry.meaning or entry.idiom

    values = {
        "成語": entry.idiom,
        "釋義": entry.meaning,
        "語義重點": semantic,
        "用法說明-語義說明": entry.usage_meaning,
        "用法說明-使用類別": entry.usage_class,
        "關鍵概念": category_pack["關鍵概念"],
        "近義成語": entry.synonyms,
        "反義成語": entry.antonyms,
        "反義排除": entry.antonyms or "無",
        "視覺策略": category_pack["視覺策略"],
        "主要主體": category_pack["主要主體"],
        "場景設定": category_pack["場景設定"],
        "核心視覺關係": category_pack["核心視覺關係"],
        "構圖方式": category_pack["構圖方式"],
        "視覺風格": category_pack["視覺風格"],
    }
    return values


def render_template(template: str, values: dict[str, str]) -> str:
    out = template
    for key, value in values.items():
        out = out.replace(f"{{{{{key}}}}}", value)
    return out


def extract_prompt_body(template: str) -> str:
    match = re.search(r"```markdown\s*(.*?)\s*```", template, re.S)
    if match:
        return match.group(1).strip()
    return template.strip()


def build_markdown(entry: IdiomEntry, values: dict[str, str], rendered_prompt: str) -> str:
    def row(label: str, value: str) -> str:
        return f"| {label} | {value or '（空）'} |"

    basic_rows = [
        row("編號", str(entry.id)),
        row("成語", entry.idiom),
        row("主條成語／非主條成語", entry.main_type),
        row("釋義", entry.meaning),
        row("用法說明-語義說明", entry.usage_meaning),
        row("用法說明-使用類別", entry.usage_class),
        row("近義成語", entry.synonyms),
        row("反義成語", entry.antonyms),
    ]

    param_rows = [
        row("成語", values["成語"]),
        row("釋義", values["釋義"]),
        row("語義重點", values["語義重點"]),
        row("用法說明-語義說明", values["用法說明-語義說明"]),
        row("用法說明-使用類別", values["用法說明-使用類別"]),
        row("關鍵概念", values["關鍵概念"]),
        row("近義成語", values["近義成語"]),
        row("反義成語", values["反義成語"]),
        row("反義排除", values["反義排除"]),
        row("視覺策略", values["視覺策略"]),
        row("主要主體", values["主要主體"]),
        row("場景設定", values["場景設定"]),
        row("核心視覺關係", values["核心視覺關係"]),
        row("構圖方式", values["構圖方式"]),
        row("視覺風格", values["視覺風格"]),
    ]

    prompt_block = "```markdown\n" + rendered_prompt.strip() + "\n```"
    return "\n".join(
        [
            f"# {entry.id}. {entry.idiom}",
            "",
            "## 成語基本資料",
            "",
            "| 欄位 | 內容 |",
            "|---|---|",
            *basic_rows,
            "",
            "## 提示詞參數",
            "",
            "| 參數 | 內容 |",
            "|---|---|",
            *param_rows,
            "",
            "## 完整圖片生成提示詞",
            "",
            prompt_block,
            "",
        ]
    )


def load_todo_lines() -> list[str]:
    return TODO_PATH.read_text(encoding="utf-8").splitlines()


def update_todo_line(lines: list[str], target_id: int) -> bool:
    changed = False
    for i, line in enumerate(lines):
        if re.match(rf"^- \[[ xX]\] {target_id}\.", line):
            suffix = line.split(".", 1)[1]
            lines[i] = f"- [x] {target_id}.{suffix}"
            changed = True
            break
    return changed


def rewrite_todo(lines: list[str]) -> None:
    TODO_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def generate(
    limit: int | None = None,
    start_after: int | None = None,
    dry_run: bool = False,
    all_entries: bool = False,
) -> None:
    rows = load_rows()
    entries = load_main_entries(rows)
    todo_lines = load_todo_lines()
    template = TEMPLATE_PATH.read_text(encoding="utf-8")
    template_body = extract_prompt_body(template)
    PROMPT_DIR.mkdir(parents=True, exist_ok=True)

    done = 0
    for line in todo_lines:
        match = TODO_LINE_RE.match(line)
        if not match:
            continue
        idiom_id = int(match.group(1))
        if start_after is not None and idiom_id <= start_after:
            continue
        if not all_entries and line.startswith("- [x]"):
            continue
        entry = entries.get(idiom_id)
        if entry is None:
            raise KeyError(f"找不到主條成語編號：{idiom_id}")

        values = build_template_values(entry)
        rendered_prompt = render_template(template_body, values)
        if "{{" in rendered_prompt or "}}" in rendered_prompt:
            raise ValueError(f"模板替換後仍有殘留 placeholder：{idiom_id}")

        markdown = build_markdown(entry, values, rendered_prompt)
        if not dry_run:
            out_path = PROMPT_DIR / f"{idiom_id}.md"
            out_path.write_text(markdown, encoding="utf-8")
            if not update_todo_line(todo_lines, idiom_id):
                raise RuntimeError(f"TODO 行未找到：{idiom_id}")
            rewrite_todo(todo_lines)

        done += 1
        if limit is not None and done >= limit:
            break


def main() -> None:
    parser = argparse.ArgumentParser(description="批次產生成語提示詞 Markdown 並更新 TODO")
    parser.add_argument("--limit", type=int, default=None, help="只處理前 N 筆主條成語")
    parser.add_argument("--start-after", type=int, default=None, help="只處理編號大於指定值的項目")
    parser.add_argument("--dry-run", action="store_true", help="只檢查不寫入")
    parser.add_argument("--all", action="store_true", help="忽略 TODO 勾選狀態，重新生成全部項目")
    args = parser.parse_args()
    generate(limit=args.limit, start_after=args.start_after, dry_run=args.dry_run, all_entries=args.all)


if __name__ == "__main__":
    main()
