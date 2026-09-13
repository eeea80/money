/**
 * Federal Reserve Provider Module.
 * Maps to: openbb_platform/providers/federal_reserve/openbb_federal_reserve/__init__.py
 */

import { Provider } from '../../core/provider/abstract/provider.js'
import { FedCentralBankHoldingsFetcher } from './models/central-bank-holdings.js'
import { FedFredSearchFetcher } from './models/fred-search.js'
import { FedFredSeriesFetcher } from './models/fred-series.js'
import { FedFredReleaseTableFetcher } from './models/fred-release-table.js'
import { FedFredRegionalFetcher } from './models/fred-regional.js'
import { FedUnemploymentFetcher } from './models/unemployment.js'
import { FedMoneyMeasuresFetcher } from './models/money-measures.js'
import { FedPCEFetcher } from './models/pce.js'
import { FedTotalFactorProductivityFetcher } from './models/total-factor-productivity.js'
import { FedFomcDocumentsFetcher } from './models/fomc-documents.js'
import { FedPrimaryDealerPositioningFetcher } from './models/primary-dealer-positioning.js'
import { FedPrimaryDealerFailsFetcher } from './models/primary-dealer-fails.js'
import { FedNonfarmPayrollsFetcher } from './models/nonfarm-payrolls.js'
import { FedInflationExpectationsFetcher } from './models/inflation-expectations.js'
import { FedSloosFetcher } from './models/sloos.js'
import { FedUniversityOfMichiganFetcher } from './models/university-of-michigan.js'
import { FedEconomicConditionsChicagoFetcher } from './models/economic-conditions-chicago.js'
import { FedManufacturingOutlookNYFetcher } from './models/manufacturing-outlook-ny.js'
import { FedManufacturingOutlookTexasFetcher } from './models/manufacturing-outlook-texas.js'

export const federalReserveProvider = new Provider({
  name: 'federal_reserve',
  website: 'https://www.federalreserve.gov',
  description: 'Federal Reserve Economic Data.',
  credentials: ['api_key'],
  fetcherDict: {
    CentralBankHoldings: FedCentralBankHoldingsFetcher,
    FredSearch: FedFredSearchFetcher,
    FredSeries: FedFredSeriesFetcher,
    FredReleaseTable: FedFredReleaseTableFetcher,
    FredRegional: FedFredRegionalFetcher,
    Unemployment: FedUnemploymentFetcher,
    MoneyMeasures: FedMoneyMeasuresFetcher,
    PersonalConsumptionExpenditures: FedPCEFetcher,
    TotalFactorProductivity: FedTotalFactorProductivityFetcher,
    FomcDocuments: FedFomcDocumentsFetcher,
    PrimaryDealerPositioning: FedPrimaryDealerPositioningFetcher,
    PrimaryDealerFails: FedPrimaryDealerFailsFetcher,
    NonfarmPayrolls: FedNonfarmPayrollsFetcher,
    InflationExpectations: FedInflationExpectationsFetcher,
    Sloos: FedSloosFetcher,
    UniversityOfMichigan: FedUniversityOfMichiganFetcher,
    EconomicConditionsChicago: FedEconomicConditionsChicagoFetcher,
    ManufacturingOutlookNY: FedManufacturingOutlookNYFetcher,
    ManufacturingOutlookTexas: FedManufacturingOutlookTexasFetcher,
  },
})
