-- 単価表は追記のみ。利用記録は model_price_id で適用した単価を参照するため、行を書き換えると過去の記録の意味が変わる。
-- 改定・登録ミスの訂正は、新しい適用開始日時の行を追加して行う。
-- 行単位のトリガーなので TRUNCATE（テストの後片付け）は止めない
CREATE FUNCTION reject_model_prices_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'model_prices is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER model_prices_append_only
  BEFORE UPDATE OR DELETE ON model_prices
  FOR EACH ROW EXECUTE FUNCTION reject_model_prices_change();
