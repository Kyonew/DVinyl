import PriceHistory from '../models/PriceHistory';

export interface EstimateHistorySnapshot {
  capturedAt: Date;
  value: number;
  minValue: number;
  maxValue: number;
  itemCount: number;
}

export interface EstimateHistory {
  currency: string;
  snapshots: EstimateHistorySnapshot[];
  otherCurrencies: string[];
}

/**
 * The reader's own currency series, oldest first, plus the currencies they are not
 * looking at. Values are never converted, so different currencies stay separate series
 * and the client can explain an empty chart rather than invite a first run.
 */
export async function readEstimateHistory(collectionId: any, currency: string): Promise<EstimateHistory> {
  const snapshots = await PriceHistory.find({ collection: collectionId, currency })
    .sort({ capturedAt: 1 })
    .select('capturedAt value minValue maxValue itemCount -_id')
    .lean();

  const otherCurrencies = await PriceHistory.distinct('currency', {
    collection: collectionId,
    currency: { $ne: currency }
  });

  return { currency, snapshots: snapshots as EstimateHistorySnapshot[], otherCurrencies };
}
