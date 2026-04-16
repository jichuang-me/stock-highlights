# Skill: 东方财富资讯搜索 (Eastmoney News Search)

## 属性
- **名称**: eastmoney_financial_search
- **核心接口**: `https://mkapi2.dfcfs.com/finskillshub/api/claw/news-search`
- **功能**: 专业金融场景信息检索（研报、深度解读、政策分析）。

## 调用规范
- **请求方法**: POST
- **Payload 示例**: `{"query": "股票名称 研报", "page": 1, "size": 10}`
- **提取逻辑**: 从返回的 `list` 中提取 `title`, `source`, `time`, `url`。

## 应用建议
用于补充 `Stock Highlights` 应用中除法定公告外的“市场预期”和“机构评价”维度数据。
