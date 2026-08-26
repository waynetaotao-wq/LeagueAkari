# DraftGap vendor 搬运记录

来源: https://github.com/vigovlugt/draftgap (main, MIT License, Copyright (c) 2026 Vigo Vlugt)
原则: 逐字照抄, 全部文件经 git blob SHA 与官方仓库核对一致。

目录映射:
- packages/core/src/**        -> vendor/**            (引擎: draft/rating/risk/stats/models)
- apps/dataset/src/lolalytics -> vendor/lolalytics/   (取数)
- apps/dataset/src/utils.ts   -> vendor/utils.ts      (retry)
- apps/dataset/src/riot.ts    -> vendor/riot.ts       (ddragon)

仅有的两处改动(为使 vendor 自洽, 不改任何逻辑):
1. models/Role.ts 第1行: "../../../../apps/dataset/src/lolalytics/roles" -> "../lolalytics/roles"
2. lolalytics/index.ts 头部5个 "@draftgap/core/src/..." 别名 import -> "../..." 相对路径

注意: 取数函数中 tier 硬编码为 emerald_plus——我们的适配层(vendor 外)会以
diamond_plus 调用/覆写, 不改动 vendor 原文。

3. 批量适配: 将"以值形式引入纯类型"的 import 说明符规范为 inline `type`
   (原仓库依赖 tsc 类型消除; 规范化后对 esbuild/rollup 等零类型信息构建器安全)。
   规则: 仅当名字在目标文件中不存在运行时导出时加 type 前缀, 逐处可审计, 零逻辑改动。

4. lolalytics/qwik.ts: `function extractData` 前加 export(一词), 供实时数据壳复用
   网页 qwik/json 解析; 逻辑零改动。
   —— 实弹核准记录(2026-08): champion 数据经网页 qwik 通道验证(Zed@mid d+ 30d:
   n=209292, enemy.middle 172行x6元组[key,wr,?,?,?,games]); build-team 经 a1 直连
   验证(valid:true, 嵌套 team.{lane}, 行实为6元组——vendor 类型标注的4元组已过时,
   组装器按自适应长度解析)。ax mega 直连对外 404, 仅作先行探测层保留。
