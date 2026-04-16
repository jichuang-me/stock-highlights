# Skill: 东方财富金融核心数据 (Eastmoney Financial Data)

## 属性
- **核心接口 (行情)**: `http://push2.eastmoney.com/api/qt/stock/get`
- **核心接口 (报表)**: `https://datacenter-web.eastmoney.com/api/data/v1/get`
- **功能**: 实时行情、PE/PB 估值、ROE 同比变化、北向资金流向。

## 参数规范
- **secid**: 市场代码.{股票代码} (0 为深证, 1 为上证)。
- **Fields (f57-f100)**: 57(名称), 58(代码), 162(市盈率PE-TTM), 167(市净率PB), 168(换手率)。

## 应用建议
用于填充应用中的“多维看点画像 (Radar Chart)”和“估值变化预期”，提供硬性的基本面量化指标。
