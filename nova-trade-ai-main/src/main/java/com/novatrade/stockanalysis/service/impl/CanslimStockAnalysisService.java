package com.novatrade.stockanalysis.service.impl;

import com.novatrade.common.BusinessException;
import com.novatrade.stockanalysis.client.FuyaoApiException;
import com.novatrade.stockanalysis.client.FuyaoMarketDataClient;
import com.novatrade.stockanalysis.client.FuyaoMarketDataClient.FuyaoResult;
import com.novatrade.stockanalysis.dto.StockAnalysisResponse;
import com.novatrade.stockanalysis.dto.StockAnalysisResponse.AnnualEarnings;
import com.novatrade.stockanalysis.dto.StockAnalysisResponse.CanslimDimension;
import com.novatrade.stockanalysis.dto.StockAnalysisResponse.DataSource;
import com.novatrade.stockanalysis.dto.StockAnalysisResponse.Fundamentals;
import com.novatrade.stockanalysis.dto.StockAnalysisResponse.MarketSnapshot;
import com.novatrade.stockanalysis.dto.StockAnalysisResponse.Target;
import com.novatrade.stockanalysis.dto.StockAnalysisResponse.Technicals;
import com.novatrade.stockanalysis.service.StockAiAdviceService;
import com.novatrade.stockanalysis.service.StockAnalysisService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.function.Supplier;
import tools.jackson.databind.JsonNode;

@Service
public class CanslimStockAnalysisService implements StockAnalysisService {

    private static final String CSI_300 = "000300.SH";
    private static final ZoneId SHANGHAI = ZoneId.of("Asia/Shanghai");
    private static final String DISCLAIMER = "本结果基于同花顺金融数据 API 的公开结构化数据和 CANSLIM 规则化代理指标，仅供研究参考，不构成投资建议或收益承诺。";

    private final FuyaoMarketDataClient client;
    private final StockAiAdviceService aiAdviceService;
    private final Clock clock;

    @Autowired
    public CanslimStockAnalysisService(FuyaoMarketDataClient client, StockAiAdviceService aiAdviceService) {
        this(client, aiAdviceService, Clock.system(SHANGHAI));
    }

    CanslimStockAnalysisService(FuyaoMarketDataClient client, Clock clock) {
        this(client, analysis -> "测试环境未调用 AI", clock);
    }

    CanslimStockAnalysisService(FuyaoMarketDataClient client, StockAiAdviceService aiAdviceService, Clock clock) {
        this.client = client;
        this.aiAdviceService = aiAdviceService;
        this.clock = clock;
    }

    @Override
    public StockAnalysisResponse analyze(String stockName) {
        String query = stockName.trim();
        SourceCollector sources = new SourceCollector();
        FuyaoResult search = sources.required("/api/meta/tickers/search", () -> client.searchAStock(query));
        Target target = resolveTarget(query, search.data());

        long endMs = clock.millis();
        long startMs = Instant.ofEpochMilli(endMs).minus(400, ChronoUnit.DAYS).toEpochMilli();
        String thscode = target.thscode();

        Optional<FuyaoResult> snapshot;
        Optional<FuyaoResult> stockHistory;
        Optional<FuyaoResult> quarterlyIncome;
        Optional<FuyaoResult> annualIncome;
        Optional<FuyaoResult> annualCashFlow;
        Optional<FuyaoResult> indexHistory;
        Optional<FuyaoResult> institutionList;
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            Future<Optional<FuyaoResult>> snapshotFuture = executor.submit(() -> sources.optional(
                    "/api/a-share/prices/snapshot", () -> client.stockSnapshot(thscode)));
            Future<Optional<FuyaoResult>> stockHistoryFuture = executor.submit(() -> sources.optional(
                    "/api/a-share/prices/historical", () -> client.stockHistory(thscode, startMs, endMs)));
            Future<Optional<FuyaoResult>> quarterlyFuture = executor.submit(() -> sources.optional(
                    "/api/a-share/financials/income-statements?period=quarterly",
                    () -> client.incomeStatements(thscode, "quarterly", 8)));
            Future<Optional<FuyaoResult>> annualFuture = executor.submit(() -> sources.optional(
                    "/api/a-share/financials/income-statements?period=annual",
                    () -> client.incomeStatements(thscode, "annual", 5)));
            Future<Optional<FuyaoResult>> cashFlowFuture = executor.submit(() -> sources.optional(
                    "/api/a-share/financials/cash-flow-statements?period=annual",
                    () -> client.cashFlowStatements(thscode, "annual", 5)));
            Future<Optional<FuyaoResult>> indexFuture = executor.submit(() -> sources.optional(
                    "/api/a-share-index/prices/historical?thscode=" + CSI_300,
                    () -> client.indexHistory(CSI_300, startMs, endMs)));
            Future<Optional<FuyaoResult>> institutionFuture = executor.submit(() -> sources.optional(
                    "/api/a-share/special-data/dragon-tiger-list?board_type=org",
                    client::latestInstitutionDragonTigerList));
            snapshot = await(snapshotFuture);
            stockHistory = await(stockHistoryFuture);
            quarterlyIncome = await(quarterlyFuture);
            annualIncome = await(annualFuture);
            annualCashFlow = await(cashFlowFuture);
            indexHistory = await(indexFuture);
            institutionList = await(institutionFuture);
        }

        Optional<String> latestReport = quarterlyIncome.flatMap(result -> latestReport(result.data()));
        Optional<FuyaoResult> indicators = latestReport.flatMap(report -> sources.optional(
                "/api/a-share/financials/indicators?report=" + report,
                () -> client.financialIndicators(thscode, report)));
        if (latestReport.isEmpty()) {
            sources.warning("财务报表缺少可识别的最新报告期，C 维度无法调用财务指标接口。");
        }

        MarketSnapshot market = marketSnapshot(snapshot.orElse(null));
        List<Bar> stockBars = bars(stockHistory.orElse(null));
        List<Bar> indexBars = bars(indexHistory.orElse(null));
        List<Income> quarterly = incomes(quarterlyIncome.orElse(null));
        List<Income> annual = incomes(annualIncome.orElse(null));

        CanslimDimension currentEarnings = currentEarnings(indicators.orElse(null), quarterly);
        CanslimDimension annualEarnings = annualEarnings(annual);
        CanslimDimension newHigh = newHigh(market, stockBars);
        CanslimDimension supplyDemand = supplyDemand(stockBars);
        CanslimDimension leader = leader(stockBars, indexBars);
        CanslimDimension institutions = institutions(thscode, institutionList.orElse(null));
        CanslimDimension marketDirection = marketDirection(indexBars);
        List<CanslimDimension> dimensions = List.of(
                currentEarnings, annualEarnings, newHigh, supplyDemand, leader, institutions, marketDirection);

        sources.warning("N 使用“接近 52 周新高”作为可量化代理，不代表已验证新产品、新管理层或新商业模式。");
        sources.warning("I 仅使用最新机构龙虎榜作为资金代理，不等同于基金持仓数量或长期机构持股。");

        int score = dimensions.stream().mapToInt(CanslimDimension::score).sum();
        int coveredMaxScore = dimensions.stream()
                .filter(dimension -> !"INSUFFICIENT".equals(dimension.status()))
                .mapToInt(CanslimDimension::maxScore)
                .sum();
        BigDecimal normalized = coveredMaxScore == 0
                ? BigDecimal.ZERO
                : decimal(score * 100.0 / coveredMaxScore);
        String verdict = verdict(normalized, coveredMaxScore, marketDirection.score());

        Fundamentals fundamentals = fundamentals(quarterly, annual, annualCashFlow.orElse(null));
        Technicals technicals = technicals(market, stockBars, indexBars);
        String summary = "%s（%s）CANSLIM 已覆盖 %d/100 分的数据维度，归一化得分 %s，结论：%s。"
                .formatted(target.name(), target.thscode(), coveredMaxScore, normalized.toPlainString(), verdict);

        StockAnalysisResponse analysis = new StockAnalysisResponse(
                query, target, endMs, market, score, coveredMaxScore, normalized, verdict, summary, dimensions,
                fundamentals, technicals, List.copyOf(sources.warnings), List.copyOf(sources.dataSources),
                DISCLAIMER, null);
        return analysis.withAiAdvice(aiAdviceService.advise(analysis));
    }

    private Target resolveTarget(String query, JsonNode data) {
        List<JsonNode> items = nodes(data.path("item"));
        if (items.isEmpty()) {
            throw BusinessException.notFound("未找到名称或代码为“" + query + "”的 A 股");
        }
        String normalized = query.trim().toUpperCase(Locale.ROOT);
        List<JsonNode> exact = items.stream()
                .filter(item -> normalized.equals(text(item, "name").toUpperCase(Locale.ROOT))
                        || normalized.equals(text(item, "ticker").toUpperCase(Locale.ROOT))
                        || normalized.equals(text(item, "thscode").toUpperCase(Locale.ROOT)))
                .toList();
        JsonNode selected;
        if (exact.size() == 1) {
            selected = exact.getFirst();
        } else if (exact.isEmpty() && items.size() == 1) {
            selected = items.getFirst();
        } else {
            List<JsonNode> candidates = exact.isEmpty() ? items : exact;
            String candidateText = candidates.stream().limit(5)
                    .map(item -> text(item, "name") + "(" + text(item, "thscode") + ")")
                    .reduce((left, right) -> left + "、" + right).orElse("无");
            throw BusinessException.conflict("股票名称存在多个匹配，请改用更完整名称或代码：" + candidateText);
        }
        return new Target(text(selected, "name"), text(selected, "ticker"), text(selected, "thscode"),
                text(selected, "exchange"), text(selected, "currency"));
    }

    private CanslimDimension currentEarnings(FuyaoResult indicators, List<Income> quarterly) {
        BigDecimal profitGrowth = indicator(indicators, "net_profit_yoy_growth_ratio");
        BigDecimal revenueGrowth = indicator(indicators, "operating_income_yoy_growth_ratio");
        if (profitGrowth == null || revenueGrowth == null) {
            GrowthFallback fallback = quarterlyGrowth(quarterly);
            profitGrowth = profitGrowth == null ? fallback.profitGrowth : profitGrowth;
            revenueGrowth = revenueGrowth == null ? fallback.revenueGrowth : revenueGrowth;
        }
        if (profitGrowth == null && revenueGrowth == null) {
            return insufficient("C", "当期盈利增长", 20, "最新同比净利润与营业收入增长数据不足",
                    List.of("/api/a-share/financials/indicators", "/api/a-share/financials/income-statements"));
        }
        int score;
        if (atLeast(profitGrowth, 25) && atLeast(revenueGrowth, 20)) {
            score = 20;
        } else if (atLeast(profitGrowth, 15) && atLeast(revenueGrowth, 10)) {
            score = 14;
        } else if (positive(profitGrowth) && positive(revenueGrowth)) {
            score = 8;
        } else {
            score = 2;
        }
        Map<String, Object> evidence = evidence();
        put(evidence, "netProfitYoYGrowthPct", profitGrowth);
        put(evidence, "revenueYoYGrowthPct", revenueGrowth);
        return dimension("C", "当期盈利增长", score, 20,
                "净利润同比 %s，营业收入同比 %s".formatted(percent(profitGrowth), percent(revenueGrowth)),
                evidence, List.of("/api/a-share/financials/indicators", "/api/a-share/financials/income-statements"));
    }

    private CanslimDimension annualEarnings(List<Income> annual) {
        List<Income> usable = annual.stream()
                .filter(item -> item.fiscalYear != null && item.eps != null)
                .sorted(Comparator.comparing(item -> item.fiscalYear)).toList();
        if (usable.size() < 3) {
            return insufficient("A", "年度盈利增长", 20, "至少需要 3 期有效年度 EPS 数据",
                    List.of("/api/a-share/financials/income-statements?period=annual"));
        }
        Income first = usable.getFirst();
        Income last = usable.getLast();
        int years = last.fiscalYear - first.fiscalYear;
        BigDecimal cagr = null;
        if (years > 0 && positive(first.eps) && positive(last.eps)) {
            cagr = decimal((Math.pow(last.eps.doubleValue() / first.eps.doubleValue(), 1.0 / years) - 1) * 100);
        }
        int improvingPeriods = 0;
        for (int index = 1; index < usable.size(); index++) {
            if (usable.get(index).eps.compareTo(usable.get(index - 1).eps) > 0) {
                improvingPeriods++;
            }
        }
        int score = atLeast(cagr, 25) && improvingPeriods >= usable.size() - 2 ? 20
                : atLeast(cagr, 15) ? 15 : positive(cagr) ? 9 : 2;
        Map<String, Object> evidence = evidence();
        put(evidence, "epsCagrPct", cagr);
        evidence.put("years", years);
        evidence.put("improvingPeriods", improvingPeriods);
        evidence.put("observations", usable.size());
        return dimension("A", "年度盈利增长", score, 20,
                "%d 年 EPS 复合增速 %s，%d 个期间实现增长".formatted(years, percent(cagr), improvingPeriods),
                evidence, List.of("/api/a-share/financials/income-statements?period=annual"));
    }

    private CanslimDimension newHigh(MarketSnapshot market, List<Bar> bars) {
        BigDecimal lastPrice = market == null ? null : market.lastPrice();
        if (lastPrice == null && !bars.isEmpty()) {
            lastPrice = bars.getLast().close;
        }
        BigDecimal high = bars.stream().map(bar -> bar.high).filter(this::positive)
                .max(BigDecimal::compareTo).orElse(null);
        if (lastPrice == null || high == null) {
            return insufficient("N", "新高与新驱动（价格代理）", 10, "52 周价格数据不足",
                    List.of("/api/a-share/prices/historical", "/api/a-share/prices/snapshot"));
        }
        BigDecimal proximity = ratio(lastPrice, high).multiply(BigDecimal.valueOf(100));
        BigDecimal distance = proximity.subtract(BigDecimal.valueOf(100));
        int score = atLeast(proximity, 95) ? 10 : atLeast(proximity, 85) ? 7 : atLeast(proximity, 70) ? 4 : 1;
        Map<String, Object> evidence = evidence();
        put(evidence, "lastPrice", lastPrice);
        put(evidence, "high52Week", high);
        put(evidence, "distanceFromHighPct", distance);
        evidence.put("proxy", "price-near-52-week-high");
        return dimension("N", "新高与新驱动（价格代理）", score, 10,
                "现价距离 52 周最高价 %s".formatted(percent(distance)), evidence,
                List.of("/api/a-share/prices/historical", "/api/a-share/prices/snapshot"));
    }

    private CanslimDimension supplyDemand(List<Bar> bars) {
        if (bars.size() < 40) {
            return insufficient("S", "供给与需求", 15, "至少需要 40 个交易日的成交量数据",
                    List.of("/api/a-share/prices/historical"));
        }
        BigDecimal recentVolume = average(bars.subList(bars.size() - 20, bars.size()).stream().map(bar -> bar.volume).toList());
        BigDecimal priorVolume = average(bars.subList(bars.size() - 40, bars.size() - 20).stream().map(bar -> bar.volume).toList());
        BigDecimal volumeRatio = ratio(recentVolume, priorVolume);
        BigDecimal priceReturn = returnPct(bars, 20);
        int score = atLeast(volumeRatio, 1.5) && positive(priceReturn) ? 15
                : atLeast(volumeRatio, 1.1) && positive(priceReturn) ? 11 : positive(priceReturn) ? 7 : 3;
        Map<String, Object> evidence = evidence();
        put(evidence, "recent20DayAverageVolume", recentVolume);
        put(evidence, "prior20DayAverageVolume", priorVolume);
        put(evidence, "recentToPriorVolumeRatio", volumeRatio);
        put(evidence, "priceReturn20DayPct", priceReturn);
        return dimension("S", "供给与需求", score, 15,
                "近 20 日量能为此前 20 日的 %s 倍，股价同期 %s".formatted(value(volumeRatio), percent(priceReturn)),
                evidence, List.of("/api/a-share/prices/historical"));
    }

    private CanslimDimension leader(List<Bar> stockBars, List<Bar> indexBars) {
        BigDecimal stockReturn = returnPct(stockBars, 120);
        BigDecimal indexReturn = returnPct(indexBars, 120);
        if (stockReturn == null || indexReturn == null) {
            return insufficient("L", "龙头相对强度", 15, "个股或沪深 300 的 120 日价格数据不足",
                    List.of("/api/a-share/prices/historical", "/api/a-share-index/prices/historical"));
        }
        BigDecimal relative = stockReturn.subtract(indexReturn);
        int score = atLeast(relative, 20) ? 15 : atLeast(relative, 10) ? 11 : atLeast(relative, 0) ? 7 : 2;
        Map<String, Object> evidence = evidence();
        put(evidence, "stockReturn120DayPct", stockReturn);
        put(evidence, "csi300Return120DayPct", indexReturn);
        put(evidence, "relativeStrengthPctPoints", relative);
        evidence.put("benchmark", CSI_300);
        return dimension("L", "龙头相对强度", score, 15,
                "近 120 日相对沪深 300 超额收益 %s 个百分点".formatted(value(relative)), evidence,
                List.of("/api/a-share/prices/historical", "/api/a-share-index/prices/historical"));
    }

    private CanslimDimension institutions(String thscode, FuyaoResult result) {
        if (result == null) {
            return insufficient("I", "机构参与（龙虎榜代理）", 5, "最新机构龙虎榜数据不可用",
                    List.of("/api/a-share/special-data/dragon-tiger-list?board_type=org"));
        }
        JsonNode stock = nodes(result.data().path("stock_items")).stream()
                .filter(item -> thscode.equalsIgnoreCase(text(item, "thscode"))).findFirst().orElse(null);
        Map<String, Object> evidence = evidence();
        put(evidence, "tradeDate", textOrNull(result.data(), "trade_date"));
        evidence.put("listedOnLatestInstitutionBoard", stock != null);
        int score;
        String summary;
        if (stock == null) {
            score = 2;
            summary = "最新可用机构龙虎榜未出现该股票；该结果不代表不存在机构持仓";
        } else {
            BigDecimal net = number(stock, "org_net_value");
            put(evidence, "institutionNetValue", net);
            put(evidence, "boardNetValue", number(stock, "net_value"));
            score = positive(net) ? 5 : net != null && net.signum() < 0 ? 1 : 3;
            summary = "最新机构龙虎榜机构净额为 " + value(net);
        }
        return dimension("I", "机构参与（龙虎榜代理）", score, 5, summary, evidence,
                List.of("/api/a-share/special-data/dragon-tiger-list?board_type=org"));
    }

    private CanslimDimension marketDirection(List<Bar> indexBars) {
        if (indexBars.size() < 50) {
            return insufficient("M", "市场方向", 15, "沪深 300 均线数据不足",
                    List.of("/api/a-share-index/prices/historical"));
        }
        BigDecimal close = indexBars.getLast().close;
        BigDecimal ma50 = movingAverage(indexBars, 50);
        BigDecimal ma200 = indexBars.size() >= 200 ? movingAverage(indexBars, 200) : null;
        BigDecimal return20 = returnPct(indexBars, 20);
        int score = ma200 != null && close.compareTo(ma50) > 0 && ma50.compareTo(ma200) > 0 ? 15
                : close.compareTo(ma50) > 0 ? 9 : 3;
        Map<String, Object> evidence = evidence();
        evidence.put("benchmark", CSI_300);
        put(evidence, "latestClose", close);
        put(evidence, "ma50", ma50);
        put(evidence, "ma200", ma200);
        put(evidence, "return20DayPct", return20);
        return dimension("M", "市场方向", score, 15,
                "沪深 300 最新收盘 %s，MA50 %s，MA200 %s".formatted(value(close), value(ma50), value(ma200)),
                evidence, List.of("/api/a-share-index/prices/historical"));
    }

    private Fundamentals fundamentals(List<Income> quarterly, List<Income> annual, FuyaoResult cashFlow) {
        Income latestQuarter = quarterly.stream().max(Comparator.comparingLong(item -> item.periodEndMs)).orElse(null);
        List<AnnualEarnings> annualEarnings = annual.stream()
                .sorted(Comparator.comparing((Income item) -> item.fiscalYear,
                        Comparator.nullsLast(Comparator.reverseOrder())))
                .map(item -> new AnnualEarnings(item.fiscalYear, item.eps, item.revenue, item.netProfit)).toList();
        JsonNode latestCash = cashFlow == null ? null : nodes(cashFlow.data().path("item")).stream()
                .max(Comparator.comparingLong(item -> longValue(item, "period_end_ms"))).orElse(null);
        BigDecimal operatingCash = latestCash == null ? null : number(latestCash, "act_cash_flow_net");
        BigDecimal latestAnnualProfit = annual.stream().max(Comparator.comparingLong(item -> item.periodEndMs))
                .map(item -> item.netProfit).orElse(null);
        return new Fundamentals(
                latestQuarter == null ? null : reportFromTimestamp(latestQuarter.periodEndMs),
                latestQuarter == null ? null : latestQuarter.eps,
                latestQuarter == null ? null : latestQuarter.revenue,
                latestQuarter == null ? null : latestQuarter.netProfit,
                annualEarnings, operatingCash, ratio(operatingCash, latestAnnualProfit));
    }

    private Technicals technicals(MarketSnapshot market, List<Bar> stockBars, List<Bar> indexBars) {
        BigDecimal high = stockBars.stream().map(bar -> bar.high).filter(this::positive).max(BigDecimal::compareTo).orElse(null);
        BigDecimal lastPrice = market == null ? null : market.lastPrice();
        if (lastPrice == null && !stockBars.isEmpty()) {
            lastPrice = stockBars.getLast().close;
        }
        BigDecimal distance = lastPrice == null || high == null ? null
                : ratio(lastPrice, high).multiply(BigDecimal.valueOf(100)).subtract(BigDecimal.valueOf(100));
        BigDecimal volumeRatio = null;
        if (stockBars.size() >= 40) {
            BigDecimal recent = average(stockBars.subList(stockBars.size() - 20, stockBars.size()).stream().map(bar -> bar.volume).toList());
            BigDecimal prior = average(stockBars.subList(stockBars.size() - 40, stockBars.size() - 20).stream().map(bar -> bar.volume).toList());
            volumeRatio = ratio(recent, prior);
        }
        BigDecimal stockReturn120 = returnPct(stockBars, 120);
        BigDecimal indexReturn120 = returnPct(indexBars, 120);
        return new Technicals(high, distance, returnPct(stockBars, 20), stockReturn120, indexReturn120,
                stockReturn120 == null || indexReturn120 == null ? null : stockReturn120.subtract(indexReturn120),
                volumeRatio, movingAverage(indexBars, 50), movingAverage(indexBars, 200));
    }

    private MarketSnapshot marketSnapshot(FuyaoResult result) {
        if (result == null) {
            return null;
        }
        JsonNode item = nodes(result.data().path("item")).stream().findFirst().orElse(null);
        if (item == null) {
            return null;
        }
        return new MarketSnapshot(nullableLong(result.data(), "timestamp"), number(item, "last_price"),
                number(item, "price_change"), number(item, "price_change_ratio_pct"), number(item, "open_price"),
                number(item, "high_price"), number(item, "low_price"), number(item, "prev_price"),
                number(item, "volume"), number(item, "turnover"));
    }

    private List<Bar> bars(FuyaoResult result) {
        if (result == null) {
            return List.of();
        }
        return nodes(result.data().path("item")).stream()
                .map(item -> new Bar(longValue(item, "date_ms"), number(item, "high_price"),
                        number(item, "close_price"), number(item, "volume")))
                .filter(bar -> bar.dateMs > 0 && bar.close != null)
                .sorted(Comparator.comparingLong(bar -> bar.dateMs)).toList();
    }

    private List<Income> incomes(FuyaoResult result) {
        if (result == null) {
            return List.of();
        }
        return nodes(result.data().path("item")).stream()
                .map(item -> new Income(longValue(item, "period_end_ms"), integer(item, "fiscal_year"),
                        textOrNull(item, "fiscal_period"), number(item, "basic_eps"), number(item, "operating_income"),
                        firstNumber(item, "parent_holder_net_profit", "net_profit")))
                .filter(item -> item.periodEndMs > 0).toList();
    }

    private Optional<String> latestReport(JsonNode data) {
        return nodes(data.path("item")).stream().mapToLong(item -> longValue(item, "period_end_ms")).max()
                .stream().mapToObj(this::reportFromTimestamp).findFirst();
    }

    private String reportFromTimestamp(long timestamp) {
        ZonedDateTime date = Instant.ofEpochMilli(timestamp).atZone(SHANGHAI);
        int report = date.getMonthValue() <= 3 ? 1 : date.getMonthValue() <= 6 ? 2 : date.getMonthValue() <= 9 ? 3 : 4;
        return date.getYear() + "-" + report;
    }

    private BigDecimal indicator(FuyaoResult result, String expectedId) {
        if (result == null) {
            return null;
        }
        for (JsonNode ability : nodes(result.data().path("abilities"))) {
            for (JsonNode item : nodes(ability.path("indicators"))) {
                String id = text(item, "index_id");
                if (id.equals(expectedId) || id.endsWith("_" + expectedId)) {
                    return number(item, "value");
                }
            }
        }
        return null;
    }

    private Optional<FuyaoResult> await(Future<Optional<FuyaoResult>> future) {
        try {
            return future.get();
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw BusinessException.serviceUnavailable("股票分析任务被中断");
        } catch (ExecutionException exception) {
            if (exception.getCause() instanceof RuntimeException runtimeException) {
                throw runtimeException;
            }
            throw BusinessException.serviceUnavailable("股票分析任务执行失败");
        }
    }

    private GrowthFallback quarterlyGrowth(List<Income> quarterly) {
        Income latest = quarterly.stream().max(Comparator.comparingLong(item -> item.periodEndMs)).orElse(null);
        if (latest == null) {
            return new GrowthFallback(null, null);
        }
        ZonedDateTime latestDate = Instant.ofEpochMilli(latest.periodEndMs).atZone(SHANGHAI);
        Income previous = quarterly.stream().filter(item -> {
            ZonedDateTime date = Instant.ofEpochMilli(item.periodEndMs).atZone(SHANGHAI);
            return date.getYear() == latestDate.getYear() - 1 && date.getMonthValue() == latestDate.getMonthValue();
        }).findFirst().orElse(null);
        return previous == null ? new GrowthFallback(null, null)
                : new GrowthFallback(growthPct(latest.netProfit, previous.netProfit),
                        growthPct(latest.revenue, previous.revenue));
    }

    private BigDecimal growthPct(BigDecimal current, BigDecimal previous) {
        if (current == null || previous == null || previous.signum() == 0) {
            return null;
        }
        return current.subtract(previous).divide(previous.abs(), 8, RoundingMode.HALF_UP)
                .multiply(BigDecimal.valueOf(100)).setScale(2, RoundingMode.HALF_UP);
    }

    private BigDecimal returnPct(List<Bar> bars, int tradingDays) {
        if (bars.size() < tradingDays + 1) {
            return null;
        }
        BigDecimal start = bars.get(bars.size() - tradingDays - 1).close;
        BigDecimal end = bars.getLast().close;
        if (!positive(start) || end == null) {
            return null;
        }
        return end.subtract(start).divide(start, 8, RoundingMode.HALF_UP)
                .multiply(BigDecimal.valueOf(100)).setScale(2, RoundingMode.HALF_UP);
    }

    private BigDecimal movingAverage(List<Bar> bars, int days) {
        return bars.size() < days ? null
                : average(bars.subList(bars.size() - days, bars.size()).stream().map(bar -> bar.close).toList());
    }

    private BigDecimal average(List<BigDecimal> values) {
        List<BigDecimal> available = values.stream().filter(value -> value != null).toList();
        return available.isEmpty() ? null : available.stream().reduce(BigDecimal.ZERO, BigDecimal::add)
                .divide(BigDecimal.valueOf(available.size()), 4, RoundingMode.HALF_UP);
    }

    private BigDecimal ratio(BigDecimal numerator, BigDecimal denominator) {
        return numerator == null || denominator == null || denominator.signum() == 0 ? null
                : numerator.divide(denominator, 4, RoundingMode.HALF_UP);
    }

    private CanslimDimension dimension(String code, String name, int score, int maxScore, String summary,
                                       Map<String, Object> evidence, List<String> endpoints) {
        String status = score >= maxScore * 0.7 ? "PASS" : score >= maxScore * 0.4 ? "WATCH" : "FAIL";
        return new CanslimDimension(code, name, score, maxScore, status, summary, Map.copyOf(evidence), endpoints);
    }

    private CanslimDimension insufficient(String code, String name, int maxScore, String summary, List<String> endpoints) {
        return new CanslimDimension(code, name, 0, maxScore, "INSUFFICIENT", summary, Map.of(), endpoints);
    }

    private String verdict(BigDecimal normalized, int coveredMaxScore, int marketScore) {
        if (coveredMaxScore < 60) {
            return "数据覆盖不足，仅保留已取得维度的研究结果";
        }
        if (normalized.compareTo(BigDecimal.valueOf(75)) >= 0 && coveredMaxScore >= 80 && marketScore >= 9) {
            return "较强候选，但仍需核验基本面事件和风险";
        }
        return normalized.compareTo(BigDecimal.valueOf(60)) >= 0
                ? "观察候选，尚未形成完整 CANSLIM 共振"
                : "当前规则下暂不符合 CANSLIM 强势候选条件";
    }

    private Map<String, Object> evidence() {
        return new LinkedHashMap<>();
    }

    private void put(Map<String, Object> map, String key, Object value) {
        if (value != null) {
            map.put(key, value);
        }
    }

    private boolean positive(BigDecimal value) {
        return value != null && value.signum() > 0;
    }

    private boolean atLeast(BigDecimal value, double threshold) {
        return value != null && value.compareTo(BigDecimal.valueOf(threshold)) >= 0;
    }

    private BigDecimal decimal(double value) {
        return BigDecimal.valueOf(value).setScale(2, RoundingMode.HALF_UP);
    }

    private String percent(BigDecimal value) {
        return value == null ? "--" : value.setScale(2, RoundingMode.HALF_UP).toPlainString() + "%";
    }

    private String value(BigDecimal value) {
        return value == null ? "--" : value.stripTrailingZeros().toPlainString();
    }

    private List<JsonNode> nodes(JsonNode node) {
        if (node == null || !node.isArray()) {
            return List.of();
        }
        List<JsonNode> values = new ArrayList<>();
        node.forEach(values::add);
        return values;
    }

    private String text(JsonNode node, String field) {
        String value = textOrNull(node, field);
        return value == null ? "" : value;
    }

    private String textOrNull(JsonNode node, String field) {
        JsonNode value = node == null ? null : node.get(field);
        return value == null || value.isNull() ? null : value.asText();
    }

    private BigDecimal number(JsonNode node, String field) {
        JsonNode value = node == null ? null : node.get(field);
        if (value == null || value.isNull() || (!value.isNumber() && !value.isTextual())) {
            return null;
        }
        try {
            return value.isTextual() ? new BigDecimal(value.asText().trim()) : value.decimalValue();
        } catch (RuntimeException exception) {
            return null;
        }
    }

    private BigDecimal firstNumber(JsonNode node, String... fields) {
        for (String field : fields) {
            BigDecimal value = number(node, field);
            if (value != null) {
                return value;
            }
        }
        return null;
    }

    private Integer integer(JsonNode node, String field) {
        JsonNode value = node == null ? null : node.get(field);
        return value == null || !value.canConvertToInt() ? null : value.asInt();
    }

    private long longValue(JsonNode node, String field) {
        JsonNode value = node == null ? null : node.get(field);
        return value == null || !value.canConvertToLong() ? 0 : value.asLong();
    }

    private Long nullableLong(JsonNode node, String field) {
        long value = longValue(node, field);
        return value == 0 ? null : value;
    }

    private record Bar(long dateMs, BigDecimal high, BigDecimal close, BigDecimal volume) {
    }

    private record Income(long periodEndMs, Integer fiscalYear, String fiscalPeriod, BigDecimal eps,
                          BigDecimal revenue, BigDecimal netProfit) {
    }

    private record GrowthFallback(BigDecimal profitGrowth, BigDecimal revenueGrowth) {
    }

    private class SourceCollector {
        private final List<String> warnings = Collections.synchronizedList(new ArrayList<>());
        private final List<DataSource> dataSources = Collections.synchronizedList(new ArrayList<>());

        private FuyaoResult required(String endpoint, Supplier<FuyaoResult> supplier) {
            try {
                FuyaoResult result = supplier.get();
                success(endpoint, result);
                return result;
            } catch (FuyaoApiException exception) {
                dataSources.add(new DataSource(endpoint, "FAILED", exception.getRequestId(), null));
                throw mapRequired(exception);
            }
        }

        private Optional<FuyaoResult> optional(String endpoint, Supplier<FuyaoResult> supplier) {
            try {
                FuyaoResult result = supplier.get();
                success(endpoint, result);
                return Optional.of(result);
            } catch (BusinessException exception) {
                throw exception;
            } catch (FuyaoApiException exception) {
                if (exception.getUpstreamCode() == 2001 || exception.getUpstreamCode() == 2003) {
                    throw BusinessException.serviceUnavailable("Fuyao API Key 无效或无权访问金融数据");
                }
                dataSources.add(new DataSource(endpoint, "FAILED", exception.getRequestId(), null));
                String request = exception.getRequestId() == null ? "" : "，request_id=" + exception.getRequestId();
                warnings.add(endpoint + " 暂不可用：" + exception.getMessage() + request);
                return Optional.empty();
            }
        }

        private void success(String endpoint, FuyaoResult result) {
            dataSources.add(new DataSource(endpoint, "SUCCESS", result.requestId(), nullableLong(result.data(), "timestamp")));
        }

        private void warning(String warning) {
            warnings.add(warning.trim());
        }

        private BusinessException mapRequired(FuyaoApiException exception) {
            return switch (exception.getUpstreamCode()) {
                case 2001, 2003 -> BusinessException.serviceUnavailable("Fuyao API Key 无效或无权访问金融数据");
                case 3001 -> BusinessException.notFound("同花顺金融数据未找到该股票");
                default -> BusinessException.serviceUnavailable("同花顺金融数据服务暂时不可用，请稍后重试");
            };
        }
    }
}
