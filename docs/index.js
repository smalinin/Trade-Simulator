/* 
 * GPL 3.0 license <http://www.gnu.org/licenses/>
*/

var gm;
var mUI;

var g_addNewPointInterval = null;
var g_prevSelectedTab = null;
var g_selectedTab = null;


function date2str(date) {
  const pad = (number) => number < 10 ? '0' + number : number;
     
  const dts = date.getFullYear()+"-"+pad(date.getMonth()+1)+"-"+pad(date.getDate());
  return dts+" "+pad(date.getHours())+":"+pad(date.getMinutes())+":"+pad(date.getSeconds());
}


class Market {
  constructor() {
    const localOff = (new Date()).getTimezoneOffset()/60;
    const mskOff = 3;
    this.tzOff = -1*localOff - mskOff;
    this._play = 0;
    this._save_play = 0;
    this._started = false;
    this._timeout = 1000;

    this.use_D1 = true;
    this.lastPoints = {};
    
    this.crypto = false;
    this.ticker = "Si";
    this.ticker_decimals = 0;
    this.iticker = "USDTOM";
    this.date0 = "20190620";
    this.candles = null;
    this.icandles = null;
    this.candles_tf = 5;  //timeframe in MINs
    this.capital = 100000;
    this.capital_cur = 100000;
    this.capital_max = 100000;
    this.risk = "%0.3";
    this.stop_def = 100;
    this.stop_cur = 100;
    this.stop_mode = "close";  //Not used for now
    this.stop_calc = "2*ATR";
    this.stop_orders = [];
    this.orders = [];

    this.profit_cur = 0;
    this.dd_cur = 0;

    this.pos = {D1:0, cur:0, sum_cur:0, list:[]},

    this.equity = [];
    this.equity_loaded = false;

    this.tran_id = 0;
    this.trans = [];
    this.trans_init = [];
    this.cur = {id:0, idi:0, dt:0, tm:0, h1:0, d1:0, candle:null};
  }

  run()
  {
    if (!this.cur.candle) return;
    
    let rc = true;
    const candle = this.cur.candle;

    while(rc) {
      
      rc = false;
      //market work
      const v_orders = [];
      for (const o of this.orders) {

        let price = -1;
        if (o.mode === "buy") {
          if (o.price === 0) {
            if ((""+o.id).startsWith("s#"))
              price = candle.close;
            else
              price = candle.open;
          } else if (o.price >= candle.open) {
            price = candle.open;
          } else if (o.price >= candle.low) {
            price = o.price;
          } 
        } else if (o.mode === "sell") {
          if (o.price === 0) {
            if ((""+o.id).startsWith("s#"))
              price = candle.close;
            else
              price = candle.open;
          } else if (o.price <= candle.open) {
            price = candle.open;
          } else if (o.price <= candle.high) {
            price = o.price;
          } 
        }
        if (price > 0) {
          let profit = 0;
          const dt = new Date(this.cur.candle.dtms);
          /// CALC profit and update POSITION

          const isOpeningPosition = this.pos.cur === 0 
             || (this.pos.cur > 0 && o.mode === "buy")
             || (this.pos.cur < 0 && o.mode === "sell");
          
          if (isOpeningPosition) 
          {
            const sign = o.mode === "sell" ? -1 : 1;
            this.pos.list.push({sign, price, count:o.count, id:o.id});
          }
          else
          {
            let pos = o.count;
            while(pos > 0){
              var p = this.pos.list.shift();
              if (p === undefined)
                break;
               
              if (p.count >= pos) {
                profit += (price - p.price) * pos * p.sign;
                p.count -= pos;
                pos = 0;
              } else {
                profit += (price - p.price) * p.count * p.sign;
                pos -= p.count;
                p.count = 0;
              }

              if (p.count > 0)
                this.pos.list.unshift(p);
            }
          }

          this.pos.cur = 0;
          this.pos.sum_cur = 0;
          for (var p of this.pos.list) {
            this.pos.cur += p.count * p.sign;
            this.pos.sum_cur += p.count * p.sign * p.price;
          }

          this.capital_cur += profit;
          if (this.capital_max < this.capital_cur)
            this.capital_max = this.capital_cur;
          
          this.dd_cur = (100 - 100*this.capital_cur/this.capital_max).toFixed(2);


          if (o.mode === "buy") {
            this.addTrans(o.id, 1, dt, price , o.count, profit, this.dd_cur, o.comment);
          }
          else if (o.mode === "sell") {
            this.addTrans(o.id, 2, dt, price , o.count, profit, this.dd_cur, o.comment);
          }

          mUI.remove_order_line(o.id);
          
        } else {
          v_orders.push(o);
        }
      }
      this.orders = v_orders;

      var v_stops = [];
      for (var o of this.stop_orders) {

        if (o.stop_act_price > 0) {
          var stop = o.stop_act_price;

          if (o.mode === "buystop" && candle.high >= stop) {
            var tr_id = ++this.tran_id;
            var count;
            if (o.stop_count.startsWith("%")) {
              var v = parseInt(o.stop_count.substring(1)); 
              v = isNaN(v)?100:v;
              count = Math.abs(this.pos.cur)/100*v;
              if (!gm.crypto)
                 count = Math.round(count);
            } else
              count = gm.crypto ? o.stop_count : parseInt(o.stop_count);

            if (count!=0)
              this.add_order("s#"+tr_id, "buy", o.stop_price, count, "buystop "+o.id);

            rc = true;

          } else if (o.mode === "sellstop" && candle.low <= stop) {
            var tr_id = ++this.tran_id;
            var count;
            if (o.stop_count.startsWith("%")) {
              var v = parseInt(o.stop_count.substring(1));
              v = isNaN(v)?100:v;
              count = Math.abs(this.pos.cur)/100*v;
              if (!gm.crypto)
                  count = Math.round(count);
            } else
              count = gm.crypto ? o.stop_count : parseInt(o.stop_count);

            if (count!=0)
              this.add_order("s#"+tr_id, "sell", o.stop_price, count, "sellstop "+o.id);

            rc = true;
          }
        }

        if (o.profit_act_price > 0) {
          var profit = o.profit_act_price;

          if (o.mode === "buystop" && candle.low <= profit) {
            var tr_id = ++this.tran_id;
            var count;
            if (o.profit_count.startsWith("%")) {
              var v = parseInt(o.profit_count.substring(1));
              v = isNaN(v)?100:v;
              count = Math.abs(this.pos.cur)/100*v;
              if (!gm.crypto)
                  count = Math.round(count);
            } else
              count = gm.crypto ? o.profit_count : parseInt(o.profit_count);

            if (count!=0)
              this.add_order("s#"+tr_id, "buy", o.profit_price, count, "buyprofit "+o.id);

            rc = true;

          } else if (o.mode === "sellstop" && candle.high >= profit) {
            var tr_id = ++this.tran_id;
            var count;
            if (o.profit_count.startsWith("%")) {
              var v = parseInt(o.profit_count.substring(1));
              v = isNaN(v)?100:v;
              count = Math.abs(this.pos.cur)/100*v;
              if (!gm.crypto)
                  count = Math.round(count);
            } else
              count = gm.crypto ? o.profit_count : parseInt(o.profit_count);

            if (count!=0)
              this.add_order("s#"+tr_id, "sell", o.profit_price, count, "sellprofit "+o.id);

            rc = true;
          }
        }

        if (!rc) 
          v_stops.push(o);
        else
          mUI.remove_stop_order_line(o.id);
      }
      this.stop_orders = v_stops;
    }

    // calc current profit
    if (this.pos.cur!=0) {
      var profit = 0;
      var price = candle.close;

      for (var i=0; i < this.pos.list.length; i++) {
        var p = this.pos.list[i];
        profit += (price - p.price) * p.count * p.sign;
      }

      this.profit_cur = profit;
    } else {
      this.profit_cur = 0;
    }
  }

  
  new_order(mode, price, count, stop_act, stop, stop_count, profit_act, profit, profit_count, comment) 
   {
     var tr_id = ++this.tran_id;

     try {
       switch (mode) {
         case "buy":
           {
             this.add_order("o#"+tr_id, "buy", price, count, comment);

             if (stop!=0 || profit!=0 || stop_act!=0 || profit_act!=0) {
                 if (stop!=0 && stop_act==0)
                   stop_act = stop;
                 if (profit!=0 && profit_act==0)
                   profit_act = profit;

                 this.add_stop_order("s#"+tr_id, "sellstop", 
                       stop_act, stop, stop_count,
                       profit_act, profit, profit_count);
             }
           }
           break;
         case "sell":
           {
             this.add_order("o#"+tr_id, "sell", price, count, comment);

             if (stop!=0 || profit!=0 || stop_act!=0 || profit_act!=0) {
                 if (stop!=0 && stop_act==0)
                   stop_act = stop;
                 if (profit!=0 && profit_act==0)
                   profit_act = profit;

                 this.add_stop_order("s#"+tr_id, "buystop", 
                       stop_act, stop, stop_count,
                       profit_act, profit, profit_count);
             }
           }
           break;
       }
     } catch(e) {
       console.log(e);
     }
   }


   add_stop_order(id, mode, stop_act_price, stop_price, stop_count, 
                            profit_act_price, profit_price, profit_count)
   {
     var dt = date2str(new Date(this.cur.candle.dtms));
     this.stop_orders.push({id, mode, stop_act_price, stop_price, stop_count,
                                profit_act_price, profit_price, profit_count, dt});
     if (stop_act_price!=0)
       mUI.add_stop_order_line(id, mode, stop_act_price, true);
   }

   add_order(id, mode, price, count, comment)
   {
     var dt = date2str(new Date(this.cur.candle.dtms));
     this.orders.push({id, mode, price, count, dt, comment })
     mUI.add_order_line(id, mode, price);
   }

   drop_all_stop_orders()
   {
     for (var o of this.stop_orders) {
       mUI.remove_stop_order_line(o.id);
     }
     this.stop_orders = [];
   }

   drop_all_orders()
   {
     for (var o of this.orders) {
       mUI.remove_order_line(o.id);
     }
     this.orders = [];
   }


   update_order(id, mode, price, count, comment)
   {
      var found = false;
      for (var o of this.orders) {
        if (o.id === id) {
          mUI.remove_order_line(id);
          mUI.add_order_line(id, mode, price);

          o.mode = mode;
          o.price = price;
          o.count = count;
          o.comment = comment;
          found = true;
          break;
        }
      }
      if (!found) {
        alert("Could not found order:"+id+" for update!");
      }
   }

   update_stop_order(id, mode, stop_act, stop, stop_count, profit_act, profit, profit_count)
   {
      var found = false;
      for (var o of this.stop_orders) {
        if (o.id === id) {
          mUI.remove_stop_order_line(id);
          if (stop_act!=0)
            mUI.add_stop_order_line(id, mode, stop_act, true);
          
          o.mode = mode;
          o.stop_act_price = stop_act;
          o.stop_price = stop;
          o.stop_count = stop_count;
          o.profit_act_price = profit_act;
          o.profit_price = profit;
          o.profit_count = profit_count;
          found = true;
          break;
        }
      }
      if (!found) {
        alert("Could not found stop order:"+id+" for update!");
      }
   }

   new_stop_order(mode, stop_act, stop, stop_count, profit_act, profit, profit_count)
   {
     var tr_id = ++this.tran_id;
     try {
       this.add_stop_order("s#"+tr_id, mode, 
                       stop_act, stop, stop_count,
                       profit_act, profit, profit_count);
     } catch(e) {
       console.log(e);
     }
   }
   
   
   addTrans(id, mode, date, price, volume, profit, dd, comment)
   {
     var tm = date2str(date);
     
     var tr = [{
    "id": id,
    "count": 1,
    "type_id": mode, //1-buy 2-sell
    "volume": ""+volume, // "12.0",
    "price": ""+price,  //"87.2000000000000000",
    "summ": ""+(volume*price), //1744.000000",
    "profit": ""+profit,  //227.666666",
    "security_id": 1, //16394,
    "time": tm, //"2015-10-19 19:00:37",
    "date_time": tm, //"2015-10-19 00:00:00",
    "splitPrice": price,  //87.2,
    "qb": ""
       
     }];

     $(".iChart_m5").data("iguanaChart").addTransactions(tr);
//??     $(".iChart_h1").data("iguanaChart").addTransactions(tr);
//??     $(".iChart_d1").data("iguanaChart").addTransactions(tr);

     this.trans.push({
       id, date:tm, mode, price, volume, profit, dd, comment
     });
     mUI.load_trans();
   }


   newCandle(_chart, _tf, _dt, _high, _low, _open, _close, _vol)
   {
     var p = $(_chart).data("iguanaChart").getLastPoint();

     var id = Object.keys(p.xSeries)[0];
     var dt_candle = p.xSeries[id][0];      //Date of last candle in chart
     var dt_loc = dt_candle +this.tzOff*60*60; //conv date to local TZ

     if (dt_loc == _dt) {
       //update
       var h_high = p.hloc[id][0][0];
       var h_low  = p.hloc[id][0][1];
       var h_open  = p.hloc[id][0][2];
       var h_close = p.hloc[id][0][3];

       var h_vol  = p.vl[id][0][0];

       h_high = Math.max(h_high, _high);
       h_low = Math.min(h_low, _low);
       h_close = _close; 
       h_vol += _vol;

       var data = {ltt: dt_candle*1000,
                   high: h_high,
                   low: h_low,
                   open: h_open, 
                   close: h_close,
                   vol: h_vol}
       $(_chart).data("iguanaChart").updateLastPoint(data);
       this.lastPoints[_chart] = {dt:_dt,
                                  high: h_high,    low: h_low,
                                  open: h_open,  close: h_close,
                                  vol: h_vol};
     } else {
       //add
       var newPoint = this.gen_Point(id, _dt, _high, _low, _open, _close, _vol);
//??       $(_chart).iguanaChart("addPoint", newPoint);
       $(_chart).data("iguanaChart").addPoint(newPoint);
       this.lastPoints[_chart] = {dt:_dt,
                                  high: _high,    low: _low,
                                  open: _open,  close: _close,
                                  vol: _vol};
     }
   }


   addNewTickerData(i, DT, dt, tm)
   {
     this.cur.id = i;
     this.cur.dt = parseInt(dt);
     this.cur.tm = parseInt(tm);

     this.cur.dt_cur = DT.dt_cur;

     var open  = parseFloat(this.candles.data[i][2]);
     var high  = parseFloat(this.candles.data[i][3]);
     var low   = parseFloat(this.candles.data[i][4]);
     var close = parseFloat(this.candles.data[i][5]);
     var vol   = parseFloat(this.candles.data[i][6]);

     if (this.candles_tf == 1) {
       this.newCandle(".iChart_m5", "M5", DT.m5, high, low, open, close, vol);
     } else {
       var newPoint = this.gen_Point(this.ticker, DT.m5, high, low, open, close, vol);
//??       $(".iChart_m5").iguanaChart("addPoint", newPoint);
       $(".iChart_m5").data("iguanaChart").addPoint(newPoint);
     }

     this.newCandle(".iChart_h1", "H1", DT.h1, high, low, open, close, vol);
     if (this.use_D1)
       this.newCandle(".iChart_d1", "D1", DT.d1, high, low, open, close, vol);

     var dtms = (DT.m5 - this.tzOff*60*60) * 1000;
     var dt_lbl = document.querySelector('#cur_date');
     dt_lbl.innerText = date2str(new Date(dtms));

     this.cur.candle = {
        high, low, open, close, vol, dtms
     }

     //calc stop
     var p = this.stop_calc.indexOf("ATR")
     if (p!=-1) {
       var v = parseFloat(this.stop_calc.substring(0,p));
       v = isNaN(v)?1:v;
       var atr = $(".iChart_m5").data("iguanaChart").getDataATR(100);
       this.stop_cur = parseFloat((v * atr).toFixed(this.ticker_decimals));
       if (this.stop_cur < this.stop_def)
         this.stop_cur = this.stop_def;
     }

     //update equity
     if (DT.d1 != this.pos.D1) {
        if (this.pos.D1 == 0) {
          var dt = new Date(DT.d1*1000);
          dt.setDate(dt.getDate()-1);
          this.pos.D1 = dt.getTime()/1000;
        }

        var dt = date2str(new Date((this.pos.D1 - this.tzOff*60*60) * 1000));
        var last_dt;

        if (this.equity.length > 0)
          last_dt = this.equity[this.equity.length-1].dt;

        if (dt!==last_dt)
          this.equity.push({dt, capital:this.capital_cur, dd:this.dd_cur, capital_max:this.capital_max});

        this.pos.D1 = DT.d1;
        mUI.load_equity();
     }
   }

   addNewIndexData(i, DT, dt, tm)
   {
     this.cur.idi = i;
     this.cur.dt = parseInt(dt);
     this.cur.tm = parseInt(tm);

     this.cur.dt_cur = DT.dt_cur;

     var open  = parseFloat(this.icandles.data[i][2]);
     var high  = parseFloat(this.icandles.data[i][3]);
     var low   = parseFloat(this.icandles.data[i][4]);
     var close = parseFloat(this.icandles.data[i][5]);
     var vol   = parseFloat(this.icandles.data[i][6]);

     if (this.candles_tf == 1) {
       this.newCandle(".iChart_m5i", "M5", DT.m5, high, low, open, close, vol);
     } else {
       var newPoint = this.gen_Point(this.iticker, DT.m5, high, low, open, close, vol);
//??       $(".iChart_m5i").iguanaChart("addPoint", newPoint);
       $(".iChart_m5i").data("iguanaChart").addPoint(newPoint);
     }

     this.newCandle(".iChart_h1i", "H1", DT.h1, high, low, open, close, vol);
     if (this.use_D1)
       this.newCandle(".iChart_d1i", "D1", DT.d1, high, low, open, close, vol);
   }

   addNewPoint() {
     var i = this.cur.id;
     var ii = this.cur.idi;

     if (i == 0 || this._play == 0)
       return;

     i++;
     ii++;

     if (i >= this.candles.data.length)
       return;
     if (this.icandles && ii >= this.icandles.data.length)
       return;

     var dt = this.candles.data[i][0];
     var tm = this.candles.data[i][1];
     var DT = this.getDT(dt, tm);

     var idt;
     var itm;
     var iDT;

     if (this.icandles) {
       idt = this.icandles.data[ii][0];
       itm = this.icandles.data[ii][1];
       iDT = this.getDT(idt, itm);
     }

     var newDT = new Date(this.cur.dt_cur.getTime());
     var found = false;

     while(!found && true) {
       newDT.setMinutes(newDT.getMinutes() + this.candles_tf);
       if (newDT.getTime() >= DT.dt_cur.getTime()) {
         found = true;
         this.addNewTickerData(i, DT, dt, tm);
       }
       if (this.icandles && newDT.getTime() >= iDT.dt_cur.getTime()) {
         found = true;
         this.addNewIndexData(ii, iDT, idt, itm);
       }
     }

     this.run();
   };



   handleStartData(candles, chart_m5, chart_h1, chart_d1, state_i) {
     var r = candles.data[0];
     if (r[0].toLowerCase()!=='date' || r[1].toLowerCase() !=='time' 
         || r[2].toLowerCase()!=='open'|| r[3].toLowerCase()!=='high'
         || r[4].toLowerCase()!=='low'|| r[5].toLowerCase()!=='close'
         || r[6].toLowerCase()!=='volume')
       return null;

     var cur = {id:0, dt:0, tm:0, m5:0, h1:0, d1:0, candle:null};

     var t_m5 = {
          dt: 0,  hloc: [], vl: [], xSeries: [],
          open:0, high:0, low:0, close:0, vol:0
     };
     var t_h1 = {
          dt: 0,  hloc: [], vl: [], xSeries: [],
          open:0, high:0, low:0, close:0, vol:0
     };
     var t_d1 = {
          dt: 0,  hloc: [], vl: [], xSeries: [],
          open:0, high:0, low:0, close:0, vol:0
     };


     for(var i=1; i < candles.data.length; i++) 
     {
       if (candles.data[i].length<=1)
         break;

       var dt    = candles.data[i][0];
       var tm    = candles.data[i][1];

       if (state_i) {
         if (i > state_i)
           break;
       } else {
         if (dt >= this.date0)
           break;
       }

       cur.id = i;
       cur.dt = parseInt(dt);
       cur.tm = parseInt(tm);

       var DT = this.getDT(dt, tm);
       cur.dt_cur = DT.dt_cur;

       var open = parseFloat(candles.data[i][2]);
       var high = parseFloat(candles.data[i][3]);
       var low  = parseFloat(candles.data[i][4]);
       var close = parseFloat(candles.data[i][5]);
       var vol  = parseFloat(candles.data[i][6]);

       if (this.candles_tf == 1) {
         /// gen 1h
         this.addCandle(t_m5, DT.m5, high, low, open, close, vol);
       } else {
         t_m5.dt = DT.m5;
         t_m5.open = open;
         t_m5.high = high;
         t_m5.low  = low;
         t_m5.close= close;
         t_m5.vol  = vol;
         this.pushData(t_m5);
       }

       /// gen 1h
       this.addCandle(t_h1, DT.h1, high, low, open, close, vol);
       /// gen 1d
       if (this.use_D1)
         this.addCandle(t_d1, DT.d1, high, low, open, close, vol);

     }

     var last_m5 = t_m5.xSeries[t_m5.xSeries.length-1];
     if (last_m5 != t_m5.dt)
        this.pushData(t_m5);
     cur.m5 = t_m5.dt;

     var last_h1 = t_h1.xSeries[t_h1.xSeries.length-1];
     if (last_h1 != t_h1.dt)
        this.pushData(t_h1);
     cur.h1 = t_h1.dt;

     var last_d1 = t_d1.xSeries[t_d1.xSeries.length-1];
     if (last_d1 != t_d1.dt)
        this.pushData(t_d1);
     cur.d1 = t_d1.dt;

     var rc_m5= {
         "hloc": {ID: t_m5.hloc},
           "vl": {ID: t_m5.vl},
         "xSeries" : {ID: t_m5.xSeries}
     };
     $(chart_m5).iguanaChart("addPoint", rc_m5);

     var rc_h1= {
         "hloc": {ID: t_h1.hloc},
           "vl": {ID: t_h1.vl},
         "xSeries" : {ID: t_h1.xSeries}
     };
     $(chart_h1).iguanaChart("addPoint", rc_h1);

     if (this.use_D1) {
       var rc_d1= {
         "hloc": {ID: t_d1.hloc},
           "vl": {ID: t_d1.vl},
         "xSeries" : {ID: t_d1.xSeries}
       };
       $(chart_d1).iguanaChart("addPoint", rc_d1);
     }

     $(chart_m5).data("iguanaChart").showIndicators();
     $(chart_h1).data("iguanaChart").showIndicators();

     if (this.use_D1)
       $(chart_d1).data("iguanaChart").showIndicators();

     var dtms = (t_m5.dt - this.tzOff*60*60) * 1000;

     cur.candle = {
        high: t_m5.high, low:t_m5.low, open:t_m5.open, close:t_m5.close, vol:t_m5.vol, dtms
     }

     return cur;
   }


   handleStart(state) {
     var cur = this.handleStartData(this.candles, ".iChart_m5", ".iChart_h1", ".iChart_d1", state?state.cur.id:null);

     var icur;
     if (this.icandles) {
       icur = this.handleStartData(this.icandles, ".iChart_m5i", ".iChart_h1i", ".iChart_d1i", state?state.cur.idi:null);
     }

     if (cur) {
       this.cur = cur;
       this.pos.D1 = this.cur.d1;

       var dtms = (cur.m5 - this.tzOff*60*60) * 1000;
       var dt_lbl = document.querySelector('#cur_date');
       dt_lbl.innerText = date2str(new Date(dtms));

       //--$(".iChart_m5").data("iguanaChart").setIndicators("&i0=EMA&i0_TimePeriod=7&&i1=EMA&i1_TimePeriod=14&i2=EMA_H1&i2_TimePeriod=7&&i3=EMA_H1&i3_TimePeriod=14&i4=EMA_D1&i4_TimePeriod=7&&i5=EMA_D1&i5_TimePeriod=14&");
       //--$(".iChart_h1").data("iguanaChart").setIndicators("&i0=EMA&i0_TimePeriod=7&&i1=EMA&i1_TimePeriod=14&i2=EMA_D1&i2_TimePeriod=7&&i3=EMA_D1&i3_TimePeriod=14&");
       $(".iChart_m5").data("iguanaChart").setIndicators("&i0=EMA&i0_TimePeriod=7&&i1=EMA&i1_TimePeriod=14&i2=EMA&i2_TimePeriod=84&&i3=EMA&i3_TimePeriod=168");
       $(".iChart_h1").data("iguanaChart").setIndicators("&i0=EMA&i0_TimePeriod=7&&i1=EMA&i1_TimePeriod=14");
       if (this.use_D1)
         $(".iChart_d1").data("iguanaChart").setIndicators("&i0=EMA&i0_TimePeriod=7&&i1=EMA&i1_TimePeriod=14&");

       if (icur) {
         this.cur.idi = icur.id;

         $(".iChart_m5i").data("iguanaChart").setIndicators("&i0=EMA&i0_TimePeriod=7&&i1=EMA&i1_TimePeriod=14&i2=EMA&i2_TimePeriod=84&&i3=EMA&i3_TimePeriod=168");
         $(".iChart_h1i").data("iguanaChart").setIndicators("&i0=EMA&i0_TimePeriod=7&&i1=EMA&i1_TimePeriod=14");
         if (this.use_D1)
           $(".iChart_d1i").data("iguanaChart").setIndicators("&i0=EMA&i0_TimePeriod=7&&i1=EMA&i1_TimePeriod=14&");
       }

       if (state) {
         for(var i=0; i<state.trans.length; i++) {
           var t = state.trans[i];
           this.addTrans(t.id, t.mode, new Date(t.date), t.price, t.volume, t.profit, t.dd, t.comment);
         }
       } else {

         if (this.trans_init.length > 0) {
           for (var i=0; i < this.trans_init.length; i++) {
             var t = this.trans_init[i];
             if (t.id)
               this.addTrans(t.id, t.mode, new Date(t.date), t.price, t.volume, t.profit, t.dd, t.comment);
           }
         }
       }

       this._started = true;
     }
   }
   


   pushData(data)
   {
     data.hloc.push([data.high, data.low, data.open, data.close]);
     data.vl.push(data.vol);
     data.xSeries.push(data.dt);
   }


   addCandle(data, _dt, _high, _low, _open, _close, _vol)
   {
     if (data.dt == _dt)
       {
         data.high = Math.max(data.high, _high);
         data.low = Math.min(data.low, _low);
         data.close = _close; 
         data.vol += _vol;
       }
     else
       {
         if (data.dt!=0)
           this.pushData(data);

         data.dt = _dt;
         data.open = _open;
         data.high = _high;
         data.low = _low;
         data.close = _close;
         data.vol = _vol;
       }
   }


   gen_Point (g_id, dtm, h, l, o, c, v) 
   {
     var hloc = [];
     hloc[0] = h;
     hloc[1] = l;
     hloc[2] = o;
     hloc[3] = c;

     var result = {
         "hloc": {},
         "vl": {},
         "xSeries" : {}
     };

     result["hloc"][g_id] = [hloc];
     result["vl"][g_id] = [v];
     result["xSeries"][g_id] = [dtm];

     return result;
   }

   getDT(dt, tm)
   {
     try{
       var d_y = parseInt(dt.substr(0,4));
       var d_m = parseInt(dt.substr(4,2));
       var d_d = parseInt(dt.substr(6,2));
       var d_hh = parseInt(tm.substr(0,2));
       var d_mm = parseInt(tm.substr(2,2));

       var d_m5 = Math.trunc(d_mm/5)*5;

       var d_val_m5  = (new Date(d_y, d_m-1, d_d, d_hh+this.tzOff, d_m5)).getTime()/1000;
       var d_val_h1  = (new Date(d_y, d_m-1, d_d, d_hh+this.tzOff, 0)).getTime()/1000;
       var d_val_d1  = (new Date(d_y, d_m-1, d_d, 0+this.tzOff, 0)).getTime()/1000;
       var dt_cur = new Date(d_y, d_m-1, d_d, d_hh, d_mm);
//       var dt_next = new Date(d_y, d_m-1, d_d, d_hh+this.tzOff, d_mm);
//       dt_next.setMinutes(dt_next.getMinutes() + this.candles_tf);
//       return {m5: d_val_m5, h1: d_val_h1, d1: d_val_d1, dt_next, dt_cur:d_val_m5};
       return {m5: d_val_m5, h1: d_val_h1, d1: d_val_d1, dt_cur};
     } catch(e) {
       console.log(e);
     }
   }


}



class MarketUI {
   constructor() {
     const self = this;
     
     // Cache DOM elements
     this.elements = {
       curDate: null,
       orderDlg: {
         formMode: null,
         formPrice: null,
         formCount: null,
         formSumm: null,
         formStop: null,
         formStopActiv: null,
         formProfit: null,
         formProfitActiv: null,
         formComment: null,
         formRisk: null,
         comments: null
       },
       editOrderDlg: {
         formId: null,
         formMode: null,
         formPrice: null,
         formCount: null,
         formSumm: null,
         formComment: null,
         comments: null
       },
       editStopDlg: {
         formId: null,
         formMode: null,
         formStop: null,
         formStopActiv: null,
         formStopCount: null,
         formProfit: null,
         formProfitActiv: null,
         formProfitCount: null
       },
       status: {
         capital: null,
         profit: null,
         dd: null,
         curPos: null,
         curPosSum: null
       },
       tables: {
         stopOrders: null,
         orders: null,
         transList: null,
         equityList: null
       }
     };

     this.order_dlg = $("#order-dlg").dialog({
       autoOpen: false,
       width:550,
       height:470,
       buttons: {
         "Execute": () => {
           var rc = self.call_exec_order();
           if (rc)
             self.order_dlg.dialog("close");
         },
         Cancel: () => {
           self.order_dlg.dialog("close");
         }
       },
       close: () => {
       }
     });

     this.edit_order_dlg = $("#edit-order-dlg").dialog({
       autoOpen: false,
       width:550,
       height:260,
       buttons: {
         "OK": () => {
           var rc = self.call_edit_order();
           if (rc)
             self.edit_order_dlg.dialog("close");
         },
         Cancel: () => {
           self.edit_order_dlg.dialog("close");
         }
       },
       close: () => {
       }
     });

     this.edit_stop_dlg = $("#edit-stop-dlg").dialog({
       autoOpen: false,
       width:550,
       height:390,
       buttons: {
         "OK": () => {
           var rc = self.call_edit_stop_order();
           if (rc)
             self.edit_stop_dlg.dialog("close");
         },
         Cancel: () => {
           self.edit_stop_dlg.dialog("close");
         }
       },
       close: () => {
       }
     });

     this.order_list_dlg = $("#order-list-dlg").dialog({
       autoOpen: false,
       closeOnEscape: false,
       dialogClass:"noclose notitle",
       position: {
         my: "left bottom", at:"left bottom", of: window
       },
       width:600,
       height:280,
     });
     this.stop_order_list_dlg = $("#stop-order-list-dlg").dialog({
       autoOpen: false,
       closeOnEscape: false,
       dialogClass:"noclose notitle",
       position: {
         my: "left+5 bottom+5", at:"right bottom", of: this.order_list_dlg
       },
       width:900,
       height:280,
     });
     this.status_dlg = $("#status-dlg").dialog({
       autoOpen: false,
       closeOnEscape: false,
       dialogClass:"noclose notitle",
       position: {
         my: "left+40 bottom+5", at:"right bottom", of: this.stop_order_list_dlg
       },
       width:350,
       height:280,
     });
     this.save_trans_dlg = $("#save-trans-dlg").dialog({
       autoOpen: false,
       closeOnEscape: false,
       width:350,
       height:100,
     });
     this.save_eq_dlg = $("#save-eq-dlg").dialog({
       autoOpen: false,
       closeOnEscape: false,
       width:350,
       height:100,
     });
     
     // Initialize cached elements after DOM is ready
     this.initElements();
   }

   // Initialize DOM element cache
   initElements() {
     this.elements.curDate = document.querySelector('#cur_date');
     
     // Order dialog
     const od = this.elements.orderDlg;
     od.formMode = document.querySelector('#order-dlg #form-mode');
     od.formPrice = document.querySelector('#order-dlg #form-price');
     od.formCount = document.querySelector('#order-dlg #form-count');
     od.formSumm = document.querySelector('#order-dlg #form-summ');
     od.formStop = document.querySelector('#order-dlg #form-stop');
     od.formStopActiv = document.querySelector('#order-dlg #form-stop-activ');
     od.formProfit = document.querySelector('#order-dlg #form-profit');
     od.formProfitActiv = document.querySelector('#order-dlg #form-profit-activ');
     od.formComment = document.querySelector('#order-dlg #form-comment');
     od.formRisk = document.querySelector('#order-dlg #form-risk');
     od.comments = document.querySelector('#order-dlg #comments');
     
     // Edit order dialog
     const eod = this.elements.editOrderDlg;
     eod.formId = document.querySelector('#edit-order-dlg #form-id');
     eod.formMode = document.querySelector('#edit-order-dlg #form-mode');
     eod.formPrice = document.querySelector('#edit-order-dlg #form-price');
     eod.formCount = document.querySelector('#edit-order-dlg #form-count');
     eod.formSumm = document.querySelector('#edit-order-dlg #form-summ');
     eod.formComment = document.querySelector('#edit-order-dlg #form-comment');
     eod.comments = document.querySelector('#edit-order-dlg #comments');
     
     // Edit stop dialog
     const esd = this.elements.editStopDlg;
     esd.formId = document.querySelector('#edit-stop-dlg #form-id');
     esd.formMode = document.querySelector('#edit-stop-dlg #form-mode');
     esd.formStop = document.querySelector('#edit-stop-dlg #form-stop');
     esd.formStopActiv = document.querySelector('#edit-stop-dlg #form-stop-activ');
     esd.formStopCount = document.querySelector('#edit-stop-dlg #form-stop-count');
     esd.formProfit = document.querySelector('#edit-stop-dlg #form-profit');
     esd.formProfitActiv = document.querySelector('#edit-stop-dlg #form-profit-activ');
     esd.formProfitCount = document.querySelector('#edit-stop-dlg #form-profit-count');
     
     // Status elements
     const st = this.elements.status;
     st.capital = document.querySelector('#cp-capital');
     st.profit = document.querySelector('#cp-profit');
     st.dd = document.querySelector('#cp-dd');
     st.curPos = document.querySelector('#cp-cur_pos');
     st.curPosSum = document.querySelector('#cp-cur_pos_sum');
     
     // Tables
     const tb = this.elements.tables;
     tb.stopOrders = document.querySelector('#stop_orders tbody');
     tb.orders = document.querySelector('#orders tbody');
     tb.transList = document.querySelector('#trans_list tbody');
     tb.equityList = document.querySelector('#equity_list tbody');
   }
   
   // Helper method to get form value
   getFormValue(element, parser = (v) => v) {
     if (!element) return null;
     return parser(element.value);
   }
   
   // Helper method to set form value
   setFormValue(element, value) {
     if (element) element.value = value;
   }

   call_exec_order()
   {
     const od = this.elements.orderDlg;
     const mode = od.formMode.options[od.formMode.selectedIndex].value;
     
     try {
       const stop = this.getFormValue(od.formStop, parseFloat) || 0;
       const stop_act = this.getFormValue(od.formStopActiv, parseFloat) || 0;
       const profit = this.getFormValue(od.formProfit, parseFloat) || 0;
       const profit_act = this.getFormValue(od.formProfitActiv, parseFloat) || 0;
       const price = this.getFormValue(od.formPrice, parseFloat) || 0;
       const count = gm.crypto ? this.getFormValue(od.formCount, parseFloat)
                               : this.getFormValue(od.formCount, parseInt);
       const comment = this.getFormValue(od.formComment);

       // Save comment to localStorage
       let list = localStorage.getItem('comments_list');
       list = list ? JSON.parse(list) : {};
       list[comment] = 1;
       localStorage.setItem('comments_list', JSON.stringify(list));

       if (count < 1 || isNaN(count)) {
         alert("Count must be > 0");
         return false;
       }

       const scount = stop_act !== 0 ? "%100" : "0";
       const pcount = profit_act !== 0 ? "%100" : "0";

       gm.new_order(mode, price, count, stop_act, stop, scount, profit_act, profit, pcount, comment);
       this.load_orders();
       this.load_stop_orders();
     } catch(e) {
       console.log(e);
     }
     gm._play = gm._save_play;
     return true;
   }

   call_edit_order()
   {
     const eod = this.elements.editOrderDlg;
     const oid = this.getFormValue(eod.formId);
     const mode = eod.formMode.options[eod.formMode.selectedIndex].value;
     const comment = this.getFormValue(eod.formComment);

     // Save comment to localStorage
     let list = localStorage.getItem('comments_list');
     list = list ? JSON.parse(list) : {};
     list[comment] = 1;
     localStorage.setItem('comments_list', JSON.stringify(list));
     
     try {
       const price = this.getFormValue(eod.formPrice, parseFloat) || 0;
       const count = gm.crypto ? this.getFormValue(eod.formCount, parseFloat)
                               : this.getFormValue(eod.formCount, parseInt);

       if (count < 1 || isNaN(count)) {
         alert("Count must be > 0");
         return false;
       }

       gm.update_order(oid, mode, price, count, comment);
       this.load_orders();
     } catch(e) {
       console.log(e);
     }
     gm._play = gm._save_play;
     return true;
   }


   call_edit_stop_order()
   {
     const esd = this.elements.editStopDlg;
     const mode = esd.formMode.options[esd.formMode.selectedIndex].value;
     
     try {
       const oid = this.getFormValue(esd.formId);
       const stop = this.getFormValue(esd.formStop, parseFloat) || 0;
       const stop_act = this.getFormValue(esd.formStopActiv, parseFloat) || 0;
       const stop_count = this.getFormValue(esd.formStopCount);
       const profit = this.getFormValue(esd.formProfit, parseFloat) || 0;
       const profit_act = this.getFormValue(esd.formProfitActiv, parseFloat) || 0;
       const profit_count = this.getFormValue(esd.formProfitCount);

       // Validate stop_count format
       if (stop_count.startsWith("%")) {
         const v = parseInt(stop_count.substring(1));
         if (isNaN(v)) {
           alert("Bad value in stop_count = " + stop_count);
           return false;
         }
       }
       
       // Validate profit_count format
       if (profit_count.startsWith("%")) {
         const v = parseInt(profit_count.substring(1));
         if (isNaN(v)) {
           alert("Bad value in profit_count = " + profit_count);
           return false;
         }
       }

       if (oid.length === 0) {
         //new
         gm.new_stop_order(mode, stop_act, stop, stop_count, profit_act, profit, profit_count);
       } else {
         //update
         gm.update_stop_order(oid, mode, stop_act, stop, stop_count, profit_act, profit, profit_count);
       }

       this.load_stop_orders();

     } catch(e) {
       console.log(e);
     }
     gm._play = gm._save_play;
     return true;
   }


   click_drop_all_stop_orders()
   {
     gm.drop_all_stop_orders();
     if (this.elements.tables.stopOrders) {
       this.elements.tables.stopOrders.innerHTML = '';
     }
   }

   click_drop_all_orders()
   {
     gm.drop_all_orders();
     if (this.elements.tables.orders) {
       this.elements.tables.orders.innerHTML = '';
     }
   }


   load_trans()
   {
     const tbody = this.elements.tables.transList;
     if (!tbody) return;
     tbody.innerHTML = '';

     function mk_row(_id, _date, _mode, _price, _vol, _sum, _profit, _dd, _comment)
     {
       var dt = date2str(new Date(_date));
       return `<td id="oid">${_id}</td>
               <td>${dt}</td>
               <td>${_mode}</td>
               <td>${_price}</td>
               <td>${_vol}</td>
               <td>${_sum}</td>
               <td>${_profit}</td>
               <td>${_dd}</td>
               <td>${_comment}</td>`;
     }

     var lst = [];
     for (var v of gm.trans) {
       var mode = v.mode==1?"Buy":"Sell";
       var s = mk_row(v.id, v.date, mode, v.price, v.volume, 
                 (v.price*v.volume).toLocaleString("ru",{useGrouping:true}),
                 v.profit.toLocaleString("ru",{useGrouping:true}), 
                 v.dd, 
                 v.comment);
       var r = tbody.insertRow(-1);
       r.innerHTML = s;
     }


   }
   

   load_equity()
   {
     const tbody = this.elements.tables.equityList;
     if (!tbody) return;
     tbody.innerHTML = '';

     const mk_row = (_dt, _capital, _dd) => {
       return `<td>${_dt}</td>
               <td>${_capital}</td>
               <td>${_dd}</td>`;
     };

     for (const v of gm.equity) {
       const s = mk_row(v.dt, 
                      v.capital.toLocaleString("ru",{useGrouping:true}), 
                      v.dd);
       const r = tbody.insertRow(-1);
       r.innerHTML = s;
     }
   }


   load_stop_orders()
   {
     const tbody = this.elements.tables.stopOrders;
     if (!tbody) return;
     tbody.innerHTML = '';

     const mk_row = (_id, _mode, _stop_act_price, _stop_price, _stop_count, _profit_act_price, _profit_price, _profit_count, _date) => {
       const cmd = '<button id="r_del" class="m-list-btn" title="Delete"><span class="ui-icon ui-icon-trash"/></button>&nbsp;<button id="r_edit" class="m-list-btn" title="Edit" style="margin-left:10px;"><span class="ui-icon ui-icon-pencil"/></button>';
       return `<td style="white-space: nowrap">${cmd}</td>
               <td id="oid">${_id}</td>
               <td>${_mode}</td>
               <td>${_stop_act_price}</td>
               <td>${_stop_price}</td>
               <td>${_stop_count}</td>
               <td>${_profit_act_price}</td>
               <td>${_profit_price}</td>
               <td>${_profit_count}</td>
               <td>${_date}</td>`;
     };
     
     for (const ord of gm.stop_orders) {
       const cls = ord.mode.startsWith("buy") ? "uk-form-success" : "uk-form-danger";
       const s = mk_row(ord.id, ord.mode, 
                 ord.stop_act_price, ord.stop_price, ord.stop_count, 
                 ord.profit_act_price, ord.profit_price, ord.profit_count, ord.dt);
       const r = tbody.insertRow(-1);
       r.innerHTML = s;
       r.className = cls;
       r.querySelector("#r_del").onclick = (e) => {
         var s = e.target.closest("tr").querySelector("#oid");
         var oid = s.innerText;
         var v = [];
         for (var i=0; i < gm.stop_orders.length; i++) {
           if (gm.stop_orders[i].id !== oid)
             v.push(gm.stop_orders[i]);
           else
             this.remove_stop_order_line(oid);
         }
         gm.stop_orders = v;
         this.load_stop_orders();
       }

       r.querySelector("#r_edit").onclick = (e) => {
         var s = e.target.closest("tr").querySelector("#oid");
         var oid = s.innerText;
         for (var i=0; i < gm.stop_orders.length; i++) {
           if (gm.stop_orders[i].id === oid){
             this.click_edit_stop_order(gm.stop_orders[i]);
             break;
           }
         }
       }
     
     }
   }


   load_orders()
   {
     const tbody = this.elements.tables.orders;
     if (!tbody) return;
     tbody.innerHTML = '';

     const mk_row = (_id, _mode, _price, _count, _comment, _date) => {
       const cmd = '<button id="r_del" class="m-list-btn" title="Delete"><span class="ui-icon ui-icon-trash"/></button>&nbsp;<button id="r_edit" class="m-list-btn" title="Edit" style="margin-left:10px;"><span class="ui-icon ui-icon-pencil"/></button>';
       return `<td style="white-space: nowrap">${cmd}</td>
               <td id="oid">${_id}</td>
               <td>${_mode}</td>
               <td>${_price}</td>
               <td>${_count}</td>
               <td>${_comment}</td>
               <td>${_date}</td>`;
     };

     for (const ord of gm.orders) {
       const cls = ord.mode.startsWith("buy") ? "uk-form-success" : "uk-form-danger";
       const s = mk_row(ord.id, ord.mode, ord.price, ord.count, ord.comment, ord.dt);
       const r = tbody.insertRow(-1);
       r.innerHTML = s;
       r.className = cls;

       r.querySelector("#r_del").onclick = (e) => {
         var s = e.target.closest("tr").querySelector("#oid");
         var oid = s.innerText;
         var v = [];
         for (var i=0; i < gm.orders.length; i++) {
           if (gm.orders[i].id !== oid)
             v.push(gm.orders[i]);
           else
             this.remove_order_line(oid);
         }
         gm.orders = v;
         this.load_orders();
       }

       r.querySelector("#r_edit").onclick = (e) => {
         var s = e.target.closest("tr").querySelector("#oid");
         var oid = s.innerText;
         for (var i=0; i < gm.orders.length; i++) {
           if (gm.orders[i].id === oid){
             this.click_edit_order(gm.orders[i]);
             break;
           }
         }

       }
     }
   }


   click_close_all()
   {
     if (!gm._started) {
       alert("System wasn't initiaized");
       return;
     }

     this.click_drop_all_stop_orders();
     this.click_drop_all_orders();

     if (gm.pos.cur!=0) {
       if (gm.pos.cur > 0)
         gm.new_order("sell", 0, Math.abs(gm.pos.cur), 0, 0, 0, 0, 0, 0);
       else
         gm.new_order("buy", 0, Math.abs(gm.pos.cur), 0, 0, 0, 0, 0, 0);
     }
     this.load_orders();

   }

   add_order_line(id, mode, price)
   {
     var type_id = mode.startsWith('buy')?1:2;
     $(".iChart_m5").data("iguanaChart").addHLine({id, type_id, price});
     $(".iChart_h1").data("iguanaChart").addHLine({id, type_id, price});
   }

   remove_order_line(id)
   {
     $(".iChart_m5").data("iguanaChart").removeHLine({id});
     $(".iChart_h1").data("iguanaChart").removeHLine({id});
   }

   add_stop_order_line(id, mode, price)
   {
     var type_id = mode.startsWith('buy')?1:2;
     $(".iChart_m5").data("iguanaChart").addHLine({id, type_id, price, stop:true});
     $(".iChart_h1").data("iguanaChart").addHLine({id, type_id, price, stop:true});
   }

   remove_stop_order_line(id)
   {
     $(".iChart_m5").data("iguanaChart").removeHLine({id});
     $(".iChart_h1").data("iguanaChart").removeHLine({id});
   }

   update_screen()
   {
     const st = this.elements.status;
     const locale = "ru";
     const grouping = {useGrouping: true};
     
     this.setFormValue(st.capital, gm.capital_cur.toLocaleString(locale, grouping));
     this.setFormValue(st.profit, gm.profit_cur.toLocaleString(locale, grouping));
     this.setFormValue(st.dd, gm.dd_cur.toLocaleString(locale));
     this.setFormValue(st.curPos, gm.pos.cur.toLocaleString(locale, grouping));
     this.setFormValue(st.curPosSum, gm.pos.sum_cur.toLocaleString(locale, grouping));
     
     this.load_orders();
     this.load_stop_orders();
   }


   click_new_order()
   {
     if (!gm._started) {
       alert("System wasn't initialized");
       return;
     }
     gm._save_play = gm._play;
     gm._play = 0;

     const od = this.elements.orderDlg;
     
     // Clear form fields
     this.setFormValue(od.formCount, "");
     this.setFormValue(od.formSumm, "");
     this.setFormValue(od.formStop, "");
     this.setFormValue(od.formStopActiv, "");
     this.setFormValue(od.formProfit, "");
     this.setFormValue(od.formProfitActiv, "");

     // Update risk info
     if (od.formRisk) {
       od.formRisk.innerHTML = `&nbsp;Risk = ${gm.risk}&nbsp;&nbsp;&nbsp;Stop = ${gm.stop_cur}`;
     }

     // Load comments list
     let list = localStorage.getItem('comments_list');
     list = list ? JSON.parse(list) : {};

     let s = '';
     for (const i in list) {
       s += `<option value="${i}"></option>`;
     }
     if (od.comments) {
       od.comments.innerHTML = s;
     }

     this.order_dlg.dialog("open");
   }

   click_edit_order(order)
   {
     gm._save_play = gm._play;
     gm._play = 0;
     
     const eod = this.elements.editOrderDlg;
     
     // Fill form with order data
     this.setFormValue(eod.formId, order.id);
     this.setFormValue(eod.formMode, order.mode);
     this.setFormValue(eod.formCount, order.count);
     this.setFormValue(eod.formPrice, order.price);
     this.setFormValue(eod.formSumm, order.count * order.price);
     this.setFormValue(eod.formComment, order.comment);

     // Load comments list
     let list = localStorage.getItem('comments_list');
     list = list ? JSON.parse(list) : {};

     let s = '';
     for (const i in list) {
       s += `<option value="${i}"></option>`;
     }
     if (eod.comments) {
       eod.comments.innerHTML = s;
     }

     this.edit_order_dlg.dialog("open");
   }

   click_new_stop_order()
   {
     if (!gm._started) {
       alert("System wasn't initialized");
       return;
     }
     gm._save_play = gm._play;
     gm._play = 0;
     
     const esd = this.elements.editStopDlg;
     
     this.edit_stop_dlg.dialog("option", "title", "New Stop Order");
     
     // Clear form fields
     this.setFormValue(esd.formId, "");
     this.setFormValue(esd.formMode, "buystop");
     this.setFormValue(esd.formStop, "");
     this.setFormValue(esd.formStopActiv, "");
     this.setFormValue(esd.formStopCount, "");
     this.setFormValue(esd.formProfit, "");
     this.setFormValue(esd.formProfitActiv, "");
     this.setFormValue(esd.formProfitCount, "");
     
     this.edit_stop_dlg.dialog("open");
   }

   click_edit_stop_order(order)
   {
     gm._save_play = gm._play;
     gm._play = 0;
     
     const esd = this.elements.editStopDlg;
     
     this.edit_stop_dlg.dialog("option", "title", "Edit Stop Order");
     
     // Fill form with order data
     this.setFormValue(esd.formId, order.id);
     this.setFormValue(esd.formMode, order.mode);
     this.setFormValue(esd.formStop, order.stop_price);
     this.setFormValue(esd.formStopActiv, order.stop_act_price);
     this.setFormValue(esd.formStopCount, order.stop_count);
     this.setFormValue(esd.formProfit, order.profit_price);
     this.setFormValue(esd.formProfitActiv, order.profit_act_price);
     this.setFormValue(esd.formProfitCount, order.profit_count);
     
     this.edit_stop_dlg.dialog("open");
   }

   click_save_trans()
   {
     var l=[];
     l.push('"id"\t"Date"\t"Mode"\t"Price"\t"Count"\t"Profit"\t"DD"\t"Comment"');
     for(var t of gm.trans) {
       var s = '';
       s += '"'+t.id+'"\t';
       s += '"'+t.date+'"\t';
       s += '"'+(t.mode==1?"Buy":"Sell")+'"\t';
       s += t.price+'\t';
       s += t.volume+'\t';
       s += t.profit+'\t';
       s += t.dd+'\t';
       s += '"'+t.comment+'"';
       l.push(s);
     }

     var blob = new Blob([l.join('\n')], {type:'text/plain;charset=UTF-8'});
     document.querySelector('#save-trans-dlg #trans-download').setAttribute('href', URL.createObjectURL(blob));
     this.save_trans_dlg.dialog("open");
   }

   click_save_eq()
   {
     var l=[];
     l.push('"Date"\t"Capital"\t"DD"\t"CapitalMAX"');
     for(var t of gm.equity) {
       var s = '';
       s += '"'+date2str(new Date(t.dt))+'"\t';
       s += t.capital+'\t';
       s += t.dd+'\t';
       s += t.capital_max;
       l.push(s);
     }

     var blob = new Blob([l.join('\n')], {type:'text/plain;charset=UTF-8'});
     document.querySelector('#save-eq-dlg #eq-download').setAttribute('href', URL.createObjectURL(blob));
     this.save_eq_dlg.dialog("open");
   }


   handleLoad_5min(evt) {
     if (evt.target.files.length > 0) {
       var name = evt.target.files[0].name.split(".");
       document.querySelector('#l-ticker').value = name[0];
       Papa.parse(evt.target.files[0], {
         complete: function(results) {

           var r = results.data[0];
           if (r[0].toLowerCase()!=='date' || r[1].toLowerCase() !=='time' 
               || r[2].toLowerCase()!=='open'|| r[3].toLowerCase()!=='high'
               || r[4].toLowerCase()!=='low'|| r[5].toLowerCase()!=='close'
               || r[6].toLowerCase()!=='volume'){
             alert("Wrong data format in CSV FILE.\n Must be 'date  time  open  high  low  close  volume'\n with Candle open time.");
             return;
           }

           gm.candles = results;
         }
       });
     }                             
   }

   handleLoad_i5min(evt) {
     if (evt.target.files.length > 0) {
       var name = evt.target.files[0].name.split(".");
       document.querySelector('#l-iticker').value = name[0];
       Papa.parse(evt.target.files[0], {
         complete: function(results) {

           var r = results.data[0];
           if (r[0].toLowerCase()!=='date' || r[1].toLowerCase() !=='time' 
               || r[2].toLowerCase()!=='open'|| r[3].toLowerCase()!=='high'
               || r[4].toLowerCase()!=='low'|| r[5].toLowerCase()!=='close'
               || r[6].toLowerCase()!=='volume'){
             alert("Wrong data format in CSV FILE.\n Must be 'date  time  open  high  low  close  volume'\n with Candle open time.");
             return;
           }

           gm.icandles = results;
         }
       });
     }
   }

   handleLoad_trans(evt) {
     var self = this;
     if (evt.target.files.length > 0) {
       var name = evt.target.files[0].name.split(".");
       Papa.parse(evt.target.files[0], {
         complete: function(results) {

           var r = results.data[0];

           if (r[0]!=='id' || r[1]!='Date' || r[2]!='Mode'|| r[3]!='Price'|| r[4]!='Count'|| r[5]!='Profit'|| r[6]!='DD'|| r[7]!='Comment'){
             alert("Wrong data format in CSV FILE.\n ");
             return;
           }

           var _id = null;
           for(var i = 1; i < results.data.length; i++)
           {
             try {
               if (!results.data[i][0])
                 continue;

               _id = results.data[i][0];
               var _Date = results.data[i][1];
               var _Mode = results.data[i][2] === 'Buy' ? 1 : 2;
               var _Price = parseFloat(results.data[i][3]);
               var _Count = parseFloat(results.data[i][4]);
               var _Profit = parseFloat(results.data[i][5]);
               var _DD = parseFloat(results.data[i][6]);
               var _Comment = results.data[i][7];
               var _Comment = _Comment === 'undefined' ? undefined : _Comment;
             } catch(e) {
               console.log(e);
             }

             gm.trans_init.push({
               id:_id, date:_Date, mode:_Mode, price:_Price, volume:_Count, 
               profit:_Profit, dd:_DD, comment:_Comment
             });
           }

           if (_id) {
             try {
               var _id = parseInt(_id.substring(2));
               gm.tran_id = _id;
             } catch(e) {
             }
           }
         }
       });
     }
   }

   handleLoad_eq(evt) {
     var self = this;
     if (evt.target.files.length > 0) {
       var name = evt.target.files[0].name.split(".");
       Papa.parse(evt.target.files[0], {
         complete: function(results) {

           var r = results.data[0];

           if (r[0]!=='Date' || r[1]!='Capital' || r[2]!='DD'){
             alert("Wrong data format in CSV FILE.\n ");
             return;
           }

           var _Capital = null;
           var _Capital_MAX = null;
           var _DD = null;
           for(var i = 1; i < results.data.length; i++)
           {
             try {
               if (!results.data[i][0])
                 continue;

               var _Date = results.data[i][0];
               _Capital = parseFloat(results.data[i][1]);
               _DD = parseFloat(results.data[i][2]);
               if (results.data[i].length > 3) 
                 _Capital_MAX = parseFloat(results.data[i][3]);
             } catch(e) {
               console.log(e);
             }

             gm.equity.push({ dt:_Date, capital:_Capital, dd:_DD, capital_max:_Capital_MAX });
           }
           self.load_equity();

           if (_Capital) {
             gm.capital_cur = _Capital;
             gm.equity_loaded = true;
//??             document.querySelector('#l-capital').value = gm.capital_cur;
           }

           if (_DD)
             gm.dd_cur = _DD;

           if (_Capital_MAX)
             gm.capital_max = _Capital_MAX;
           else
             gm.capital_max = gm.capital_cur;
         }
       });
     }
   }




   handleStart() 
   {
     gm.risk = parseFloat(document.querySelector('#l-risk').value);
     if (isNaN(gm.risk)){
       alert("Wrong Risk");
       return;
     }
     gm.risk = "%"+gm.risk;

     gm.stop_def = parseFloat(document.querySelector('#l-stop_def').value);
     if (isNaN(gm.stop_def) || gm.stop_def < 0){
       alert("Wrong Stop");
       return;
     }

     gm.stop_mode = document.querySelector('#l-stop_mode').value;

     if (gm._started) {
       alert("Started already");
       return;
     }
      
     gm.capital = parseInt(document.querySelector('#l-capital').value);
     if (isNaN(gm.capital) || gm.capital < 1000){
       alert("Wrong Capital");
       return;
     }
  
     if (!gm.equity_loaded)
       gm.capital_cur = gm.capital_max = gm.capital;

     gm.candles_tf = parseInt(document.querySelector('#l-candles_tf').value);
     if (isNaN(gm.candles_tf) || gm.candles_tf < 1){
       alert("Wrong Stop");
       return;
     }

     const mode = document.querySelector('#l-mode option:checked').value;
     gm.crypto = mode === 'crypto';

     gm.date0 = document.querySelector('#l-date0').value;
     if (gm.date0.length != "20190620".length){
       alert("Wrong Start date");
       return;
     }

     gm._timeout = parseInt(document.querySelector('#l-timeout').value);
     if (isNaN(gm._timeout) || gm._timeout < 5){
       alert("Play timeout must be >= 5ms");
       return;
     }

     gm.ticker = document.querySelector('#l-ticker').value;
     if (gm.ticker.length < 1){
       alert("Empty Ticker name");
       return;
     }
     gm.iticker = document.querySelector('#l-iticker').value;
     if (gm.iticker.length < 1){
       alert("Empty Index Ticker name");
       return;
     }

     if (gm.candles === null){
       alert("Ticked data files must be loaded at first");
       return;
     }

     this.init_size();

     init_chart(".iChart_m5","I5", gm.ticker, false);
     init_chart(".iChart_h1","H1", gm.ticker, false);
     init_chart(".iChart_d1","D1", gm.ticker, false);

     if (gm.icandles !== null){
       init_chart(".iChart_m5i","I5", gm.iticker, true);
       init_chart(".iChart_h1i","H1", gm.iticker, true);
       init_chart(".iChart_d1i","D1", gm.iticker, true);
     }

     gm.handleStart();
     this.update_screen();
   }


   init_size()
   {
     var mode = document.querySelector('#l-screen option:checked').value;

     if (mode === "2K") {
       var v = document.querySelectorAll('.grid_ticker');
       v.forEach((child) => {
         child.classList.remove('grid_ticker');
         child.classList.add('grid_ticker_2K');
       });
       var v = document.querySelectorAll('.chart_ticker');
       v.forEach((child) => {
         child.classList.remove('chart_ticker');
         child.classList.add('chart_ticker_2K');
       });
     }
   }


   saveState()
   {
     var state = { 
                   _timeout: gm._timeout,
                   use_D1: gm.use_D1,
                   lastPoints: gm.lastPoints,

                   ticker: gm.ticker,
                   iticker: gm.iticker,
                   date0: gm.cur.dt,
                   candles: gm.candles,
                   icandles: gm.icandles,
                   candles_tf: gm.candles_tf,
                   mode_crypto: gm.crypto,

                   capital_cur: gm.capital_cur,
                   capital_max: gm.capital_max,
                   capital: gm.capital,

                   risk: gm.risk,
                   stop_def: gm.stop_def,
                   stop_mode: gm.stop_mode,
                   stop_calc: gm.stop_calc,

                   stop_orders: gm.stop_orders,
                   orders: gm.orders,

                   profit_cur: gm.profit_cur,
                   dd_cur: gm.dd_cur,

                   pos: gm.pos,

                   equity: gm.equity,

                   tran_id: gm.tran_id,
                   trans: gm.trans,

                   cur: gm.cur
                   }

     function saveData(db) {
         try {
           const tran = db.transaction(["stock"], "readwrite");
           const req1 = tran.objectStore("stock").put(JSON.stringify(state), 'state');
           
           req1.onerror = function(err) {
             alert("DB save error: " + err);
             console.error("Save error:", err);
           }
           
           req1.onsuccess = function() {
             alert("Data was saved successfully");
           }
           
           tran.oncomplete = function() {
             db.close();
           }
           
           tran.onerror = function(err) {
             alert("Transaction error: " + err);
             db.close();
           }
         } catch(e) {
           alert("Save exception: " + e.message);
           console.error("Save exception:", e);
           db.close();
         }
     }

     function connectDB() {
       const req = indexedDB.open("MyStock", 1);
       
       req.onsuccess = function() {
         const db = this.result;
         if (!db.objectStoreNames.contains("stock")) {
           db.close();
           alert("DB error: stock store not found");
           return;
         }
         saveData(db);
       }
       
       req.onupgradeneeded = function(e) {
         const db = this.result;
         if (!db.objectStoreNames.contains("stock")) {
           db.createObjectStore("stock");
         }
       }
       
       req.onerror = function(err) {
         alert("DB error: " + err);
       }
     }

     connectDB();

   }


   restoreState()
   {
     var self = this;

     function connectDB() {
       var req = indexedDB.open("MyStock", 1);
       req.onsuccess = function() {
         var db = this.result;
         if (!db.objectStoreNames.contains("stock")) {
           alert("Data not found");  
           db.close();
           return;
         }

         var req = db.transaction(["stock"], "readonly").objectStore("stock").get('state');
         req.onerror = function(err) {
           alert("DB load:"+err);
         }
         req.onsuccess = function(ev) {
           const val = ev.target.result; 
           if (!val) {
             alert("No saved state found");
             db.close();
             return;
           }

           try {
             const state =JSON.parse(val);
             
             // Restore market state
             gm._timeout = state._timeout;
             gm.use_D1 = state.use_D1;
             gm.lastPoints = state.lastPoints || {};

             gm.ticker = state.ticker;
             gm.iticker = state.iticker;
             gm.date0 = state.cur?.dt || state.date0;
             gm.candles = state.candles;
             gm.icandles = state.icandles;
             gm.candles_tf = state.candles_tf;
             gm.crypto = state.mode_crypto;

             gm.capital_cur = state.capital_cur;
             gm.capital_max = state.capital_max;
             gm.capital = state.capital;

             gm.risk = state.risk;
             gm.stop_def = state.stop_def;
             gm.stop_mode = state.stop_mode;
             gm.stop_calc = state.stop_calc;

             gm.stop_orders = state.stop_orders || [];
             gm.orders = state.orders || [];

             gm.profit_cur = state.profit_cur || 0;
             gm.dd_cur = state.dd_cur || 0;

             if (state.pos) {
               gm.pos = state.pos;
             }

             gm.equity = state.equity || [];
             gm.tran_id = state.tran_id || 0;

             if (state.trans) {
               gm.trans = state.trans;
             }

             if (state.cur) {
               gm.cur = state.cur;
             }

              document.querySelector('#l-capital').value = gm.capital;
              document.querySelector('#l-risk').value = (gm.risk.startsWith("%") ? gm.risk.substring(1): gm.risk);

              document.querySelector('#l-stop_def').value = gm.stop_def;
              document.querySelector('#l-stop_mode').value = gm.stop_mode;
              document.querySelector('#l-candles_tf').value = gm.candles_tf;

              document.querySelector('#l-date0').value = gm.date0;
              document.querySelector('#l-timeout').value = gm._timeout;

              document.querySelector('#l-ticker').value = gm.ticker;
              document.querySelector('#l-iticker').value = gm.iticker;

              self.init_size();
              init_chart(".iChart_m5","I5", gm.ticker, false);
              init_chart(".iChart_h1","H1", gm.ticker, false);
              init_chart(".iChart_d1","D1", gm.ticker, false);

              if (gm.icandles !== null){
                init_chart(".iChart_m5i","I5", gm.iticker, true);
                init_chart(".iChart_h1i","H1", gm.iticker, true);
                init_chart(".iChart_d1i","D1", gm.iticker, true);
              }

              gm.handleStart(state);

              self.update_screen();

              alert("Data was loaded successfully");

           } catch(e) {
             alert("Error loading state: " + e.message);
             console.error("Load error:", e);
           }

         }

         db.close();
       }

       req.onerror = function(err) {
         alert("DB error :"+err);
       }
     }

     connectDB();

   }
}  // End of MarketUI class



document.addEventListener('DOMContentLoaded', function()
{
   init();

   function init()
   {
     gm = new Market();
     mUI = new MarketUI();
     initTabs();

     mUI.update_screen();

     document.querySelector('#order-dlg #form-risk')
       .innerHTML = "&nbsp;&nbsp;Risk = "+gm.risk;

     document.querySelector('#csv_5min')
       .onchange = (e) => {mUI.handleLoad_5min(e) }

     document.querySelector('#icsv_5min')
       .onchange = (e) => {mUI.handleLoad_i5min(e) }

     document.querySelector('#icsv_trans')
       .onchange = (e) => {mUI.handleLoad_trans(e) }
     document.querySelector('#icsv_eq')
       .onchange = (e) => {mUI.handleLoad_eq(e) }

     
     document.querySelector('#start')
       .onclick = (e) => {mUI.handleStart() }


     document.querySelector('#save_state')
       .onclick = (e) => {mUI.saveState() }

     document.querySelector('#restore_state')
       .onclick = (e) => {mUI.restoreState() }

     document.querySelector('#play')
       .onclick = (e) => { clickPlay(); }

     document.querySelector('#order-dlg #get_market')
       .onclick = (e) => { 
          document.querySelector('#order-dlg #form-price').value = gm.cur.candle.close;
       };

     document.querySelector('#order-dlg #get_stop')
       .onclick = (e) => { 
         var mode = document.querySelector('#order-dlg #form-mode option:checked').value;
         try {
           var price = parseFloat(document.querySelector('#order-dlg #form-price').value);
           switch (mode) {
             case "buy":
             case "buystop":
               document.querySelector('#order-dlg #form-stop-activ').value = price - gm.stop_cur;
               break;
             case "sell":
             case "sellstop":
               document.querySelector('#order-dlg #form-stop-activ').value = price + gm.stop_cur;
               break;
           }

         } catch(e) {
           console.log(e);
         }
       };

     document.querySelector('#order-dlg #calc_pos')
       .onclick = (e) => { 
         var stop = document.querySelector('#order-dlg #form-stop-activ').value;
         var price = document.querySelector('#order-dlg #form-price').value;
         var s_risk = gm.risk;

         try {
           var risk = 0; 

           if (s_risk.startsWith("%"))
             risk = parseFloat(s_risk.substr(1))/100 * gm.capital_cur;
           else
             risk = parseFloat(s_risk);

           var count = Math.floor(risk / Math.abs(parseFloat(price) - parseFloat(stop)));
           document.querySelector('#order-dlg #form-count').value = count;
           pos_changed();
         } catch(e) {
           console.log(e);
         }
       };

     document.querySelector('#order-dlg #form-count')
       .oninput = (e) => { pos_changed(); }
     document.querySelector('#order-dlg #form-count')
       .onchange = (e) => { pos_changed(); }
     document.querySelector('#order-dlg #form-price')
       .onchange = (e) => {
         var mode = document.querySelector('#order-dlg #form-mode option:checked').value;
         try {
           var price = parseFloat(document.querySelector('#order-dlg #form-price').value);
           switch (mode) {
             case "buy":
             case "buystop":
               document.querySelector('#order-dlg #form-stop-activ').value = price - gm.stop_cur;
               break;
             case "sell":
             case "sellstop":
               document.querySelector('#order-dlg #form-stop-activ').value = price + gm.stop_cur;
               break;
           }

         } catch(e) {
           console.log(e);
         }
       }
     document.querySelector('#edit-order-dlg #form-count')
       .oninput = (e) => { edit_order_pos_changed(); }
     document.querySelector('#edit-order-dlg #form-count')
       .onchange = (e) => { edit_order_pos_changed(); }

     document.querySelector('#exec_drop_stop_orders')
       .onclick = (e) => { mUI.click_drop_all_stop_orders() }
     document.querySelector('#exec_drop_orders')
       .onclick = (e) => { mUI.click_drop_all_orders() }
     document.querySelector('#exec_new_order')
       .onclick = (e) => { mUI.click_new_order() }
     document.querySelector('#exec_close_all')
       .onclick = (e) => { mUI.click_close_all() }

     document.querySelector('#exec_new_stop_order')
       .onclick = (e) => { mUI.click_new_stop_order() }

     document.querySelector('#save-trans')
       .onclick = (e) => { mUI.click_save_trans() }
     document.querySelector('#save-eq')
       .onclick = (e) => { mUI.click_save_eq() }
   } 


   function pos_changed()
   {
     var price = document.querySelector('#order-dlg #form-price').value;
     var cnt = document.querySelector('#order-dlg #form-count').value;
     try {
       var sum = parseFloat(cnt) * parseFloat(price);
       document.querySelector('#order-dlg #form-summ').value = sum.toLocaleString("ru",{useGrouping:true});
     } catch(e) {}
   }

   function edit_order_pos_changed()
   {
     var price = document.querySelector('#edit-order-dlg #form-price').value;
     var cnt = document.querySelector('#edit-order-dlg #form-count').value;
     try {
       var sum = parseFloat(cnt) * parseFloat(price);
       document.querySelector('#edit-order-dlg #form-summ').value = sum.toLocaleString("ru",{useGrouping:true});
     } catch(e) {}
   }



   if(g_addNewPointInterval) {
      clearTimeout(g_addNewPointInterval);
   }


   function clickPlay() {
     var i = gm.cur.id;
     if (i == 0)
       return;

     function exec_trade() {
          gm.addNewPoint();
          mUI.update_screen();
          g_addNewPointInterval = setTimeout(exec_trade, gm._timeout);
     }

     if (gm._play==0) {
       gm._play = 1;
       gm._save_play = 1;
       g_addNewPointInterval = setTimeout(exec_trade, gm._timeout);
       document.querySelector('#play').innerText = 'Pause = ';
     } else {
       gm._play = 0;
       gm._save_play = 0;
       document.querySelector('#play').innerText = 'Play >> ';
       clearTimeout(g_addNewPointInterval);
     }

   }

})


function initTabs() {
  document.querySelector('#tabs a[href="#load"]')
    .onclick = (e) => {
      selectTab('#load');
      mUI.order_list_dlg.dialog("close");
      mUI.stop_order_list_dlg.dialog("close");
      mUI.status_dlg.dialog("close");
      return false;
    }
  document.querySelector('#tabs a[href="#tf5min"]')
    .onclick = (e) => {
      selectTab('#tf5min');
      mUI.order_list_dlg.dialog("open");
      mUI.stop_order_list_dlg.dialog("open");
      mUI.status_dlg.dialog("open");
      if (gm._started) {
        $(".iChart_m5").iguanaChart("render");
        if (gm.icandles)
          $(".iChart_m5i").iguanaChart("render");
      }
      return false;
    }
  document.querySelector('#tabs a[href="#tf1h"]')
    .onclick = (e) => {
      selectTab('#tf1h');
      mUI.order_list_dlg.dialog("open");
      mUI.stop_order_list_dlg.dialog("open");
      mUI.status_dlg.dialog("open");
      if (gm._started) {
        $(".iChart_h1").iguanaChart("render");
        if (gm.icandles)
          $(".iChart_h1i").iguanaChart("render");
      }
      return false;
    }
  document.querySelector('#tabs a[href="#tf1d"]')
    .onclick = (e) => {
      selectTab('#tf1d');
      mUI.order_list_dlg.dialog("open");
      mUI.stop_order_list_dlg.dialog("open");
      mUI.status_dlg.dialog("open");
      if (gm._started) {
        $(".iChart_d1").iguanaChart("render");
        if (gm.icandles)
          $(".iChart_d1i").iguanaChart("render");
      }
      return false;
    }
  document.querySelector('#tabs a[href="#trans"]')
    .onclick = (e) => {
      selectTab('#trans');
      mUI.order_list_dlg.dialog("close");
      mUI.stop_order_list_dlg.dialog("close");
      mUI.status_dlg.dialog("close");
      return false;
    }
  document.querySelector('#tabs a[href="#equity"]')
    .onclick = (e) => {
      selectTab('#equity');
      mUI.order_list_dlg.dialog("close");
      mUI.stop_order_list_dlg.dialog("close");
      mUI.status_dlg.dialog("close");
      return false;
    }
  selectTab('#load');

  function selectTab(tab)
  {
    g_prevSelectedTab = g_selectedTab;
    g_selectedTab = tab;

    function updateTab(tab, selTab)
    {
      var tab_data = document.querySelector(tab+'_items');
      var tab_id = document.querySelector('#tabs a[href="'+tab+'"]');

      if (selTab===tab) {
        tab_data.classList.remove('hidden');
        tab_id.classList.add('selected');
      } else {
        tab_data.classList.add('hidden');
        tab_id.classList.remove('selected');
      }
    }

    updateTab('#load', g_selectedTab);
    updateTab('#tf5min', g_selectedTab);
    updateTab('#tf1h', g_selectedTab);
    updateTab('#tf1d', g_selectedTab);
    updateTab('#trans', g_selectedTab);
    updateTab('#equity', g_selectedTab);
  }

}


function init_chart(chart, tf, ticker, isIndex)
{
  var tm = 5;
  var indicators = "";

  if (tf==="H1")
    tm = 60;
  else if (tf==="D1")
    tm = 60*24;
  else {
    tm = 5; //5min
  }

  var chartDS = {
    data: {
          "hloc":{ },
          "vl":{ },
          "xSeries":{ }
        },
    dataSettings: {
        useHash: false,
        hash: "",
        id: ticker,
        interval: tf,  // D1 = 1440min
        timeframe: tm,  //in mins
    }
  };

  chartDS.data.hloc[ticker]=[];
  chartDS.data.vl[ticker]=[];
  chartDS.data.xSeries[ticker]=[];

  $(chart).iguanaChart(
    {
        ticker: ticker,
        lib_path: "lib",
        period: tf,
        chartOptions: {
            minHeight: $(chart).height(),
            uiTools: {top: true},
            futureAmount: 100,
            watermarkText: ticker,
            watermarkSubText:  "",
            primaryToSecondaryAreaHeightRatio: (isIndex? 4 : 2)
        },
        dataSource: chartDS
    }
  );
  $(chart +" .tm-graph-button[data-property='dataInterval']").hide();

}

