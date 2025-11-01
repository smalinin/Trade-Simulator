if (!!TA.INDICATOR_TEMPLATE)
    TA.EMA_H1 = TA.INDICATOR_TEMPLATE.Create();
else
    TA.EMA_H1 = {};

TA.EMA_H1.name = 'EMA_H1';
TA.EMA_H1.type = 'line';

TA.EMA_H1.DefaultSettings = {
    TimePeriod: 30,
    CandleValueIdx: TA.CLOSE,
    CandleDate: TA.DATE,
    CandleTime: TA.TIME,
};

TA.EMA_H1.Settings = {};

TA.EMA_H1.calculate = function(startIdx, endIdx, dataShape, settings){
     
    var outReal = [];
    
    this.SetSettings(settings);

    if (!startIdx)
        startIdx = 0;

    if (!endIdx)
        endIdx = dataShape.length - 1;

    if (startIdx < 0)
        throw 'TA_OUT_OF_RANGE_START_INDEX';
    if ((endIdx < 0) || (endIdx < startIdx))
        throw 'TA_OUT_OF_RANGE_END_INDEX';

    if (!dataShape || !dataShape.length)
        throw 'TA_BAD_PARAM';

    if (dataShape[0][TA.PER] > 60)
        throw 'TA_BAD_PARAM';

    if (!this.Settings.TimePeriod)
        this.Settings.TimePeriod = 30;
    else if ((this.Settings.TimePeriod < 2) || (this.Settings.TimePeriod > 100000))
        throw 'TA_BAD_PARAM';

    return this._int_ema(startIdx, endIdx, dataShape,
        this.Settings.TimePeriod,
        TA.PER_TO_K(this.Settings.TimePeriod),
        outReal);
};

TA.EMA_H1._int_ema = function ( startIdx, endIdx, dataShape, optInTimePeriod, optInK_1, outReal ) {
   var tempReal, prevMA;
   var i, today, outIdx, lookbackTotal;
   var self = this;

   /* Ususally, optInK_1 = 2 / (optInTimePeriod + 1),
    * but sometime there is exception. This
    * is why both value are parameters.
    */

   /* Identify the minimum number of price bar needed
    * to calculate at least one output.
    */
   lookbackTotal = this._lookback( optInTimePeriod );
   lookbackTotal *= 12;

   /* Move up the start index if there is not
    * enough initial data.
    */
   if( startIdx < lookbackTotal )
      startIdx = lookbackTotal;

   /* Make sure there is still something to evaluate. */
   if( startIdx > endIdx )
   {
      return outReal;
   }

   /* Do the EMA calculation using tight loops. */
   
   /* The first EMA is calculated differently. It
    * then become the seed for subsequent TA.EMA_H1.
    *
    * The algorithm for this seed vary widely.
    * Only 3 are implemented here:
    *
    * TA_MA_CLASSIC:
    *    Use a simple MA of the first 'period'.
    *    This is the approach most widely documented.
    *
    * TA_MA_METASTOCK:
    *    Use first price bar value as a seed
    *    from the begining of all the available
    *    data.
    *
    * TA_MA_TRADESTATION:
    *    Use 4th price bar as a seed, except when
    *    period is 1 who use 2th price bar or something
    *    like that... (not an obvious one...).
    */
   function getDT(ishape)
   {
     return parseInt(ishape[self.Settings.CandleTime].substring(0,2));
   }

   if( TA.TA_GLOBALS_COMPATIBILITY == TA.TA_COMPATIBILITY_DEFAULT )
   {
      today = startIdx-lookbackTotal;
      i = optInTimePeriod;
      tempReal = 0.0;
      while( i-- > 0 )
         tempReal += dataShape[today++][this.Settings.CandleValueIdx];

      prevMA = tempReal / optInTimePeriod;
   }
   else
   {
      prevMA = dataShape[0][this.Settings.CandleValueIdx];
      today = 1;

      /* !!! Tradestation not supported yet.
      case TA_MA_TRADESTATION:
         prevMA = inReal[startIdx-1];
         if( optInTimePeriod == 1 )
            VALUE_HANDLE_DEREF(outBegIdx)_0 = 1;
         else
            VALUE_HANDLE_DEREF(outBegIdx)_0 = 3;
       */
   }

   /* At this point, prevMA is the first EMA (the seed for
    * the rest).
    * 'today' keep track of where the processing is within the
    * input.
    */

   /* Skip the unstable period. Do the processing 
    * but do not write it in the output.
    */   
//??????????????
//??--   while( today <= startIdx )
//??--      prevMA = ((dataShape[today++][this.Settings.CandleValueIdx]-prevMA)*optInK_1) + prevMA;

   /* Write the first value. */
   outReal[0] = prevMA;
   outIdx = 1;

   /* Calculate the remaining range. */
//??--   while( today <= endIdx ) {
//??--      prevMA = ((dataShape[today++][this.Settings.CandleValueIdx]-prevMA)*optInK_1) + prevMA;
//??--      outReal[outIdx++] = prevMA;
//??--   }

   var prev_dt = 0;
   var dt = 0;
   var ma_1 = prevMA;
   var MA = prevMA;

   while( today <= endIdx ) {
      var i = today++;
      var cur_dt = getDT(dataShape[i]);
      var last_dt = dt;

      if (cur_dt == last_dt) {
         var p_MA = prevMA;
         var v = ((dataShape[i][this.Settings.CandleValueIdx]-p_MA)*optInK_1) + p_MA;

         MA = v;
         outReal[outIdx++] = p_MA;

      } else {
         var p_MA = MA;
         var v = ((dataShape[i][this.Settings.CandleValueIdx]-p_MA)*optInK_1) + p_MA;

         outReal[outIdx++] = p_MA;
         prevMA = MA;
         MA = v;

         prev_dt = dt;
         dt = cur_dt;
      }
   }

   return outReal;
};

TA.EMA_H1.getValue = function(dataShape, itemIdx, settings) {
    
};

TA.EMA_H1._lookback = function(optInTimePeriod) {
    if ( !optInTimePeriod )
        optInTimePeriod = this.Settings.TimePeriod || this.DefaultSettings.TimePeriod;
    else if (( optInTimePeriod < 2) || ( optInTimePeriod > 100000))
        return -1;


    return optInTimePeriod - 1; // + TA_GLOBALS_UNSTABLE_PERIOD(TA_FUNC_UNST_EMA, Ema);
};

TA.EMA_H1._S = function(startIdx, endIdx, dataShape, settings) {
    var tempReal, prevMA;
    var i, today, outIdx, lookbackTotal;

    lookbackTotal = this._lookback(this.Settings.TimePeriod);
    if (startIdx < lookbackTotal)
        startIdx = lookbackTotal;
    if (startIdx > endIdx) {
        return outReal;
    }
    
    if (TA_GLOBALS_COMPATIBILITY == TA_COMPATIBILITY_DEFAULT) {
        today = startIdx - lookbackTotal;
        i = this.Settings.TimePeriod;
        tempReal = 0.0;
        while (i-- > 0)
            tempReal += dataShape[today++][this.Settings.CandleValueIdx];
        prevMA = tempReal / this.Settings.TimePeriod;
    } else {
        prevMA = dataShape[0][this.Settings.CandleValueIdx];
        today = 1;
    }
    while (today <= startIdx)
        prevMA = ((dataShape[today++][this.Settings.CandleValueIdx] - prevMA) * optInK_1) + prevMA;
    outReal[0] = prevMA;
    outIdx = 1;
    while (today <= endIdx) {
        prevMA = ((inReal[today++] - prevMA) * optInK_1) + prevMA;
        outReal[outIdx++] = prevMA;
    }
    
    return outReal;
};

TA.EMA_H1.initChart = function (dataShape, hcOptions, ticker) {
    INDICATOR_TEMPLATE.initChart.apply(this, arguments);
    
    
};

TA.EMA_H1.SetSettings(TA.EMA_H1.DefaultSettings);
