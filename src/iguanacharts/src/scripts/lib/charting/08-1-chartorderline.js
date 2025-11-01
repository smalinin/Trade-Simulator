/**
 * @company  Tradernet
 * @package  iguanaChart
 */
(function ()
{
    "use strict";

    iChart.Charting.ChartOrderLine = function (layer)
    {
        iChart.Charting.ChartElement.prototype.constructor.call(this, layer);

        this.elementType = "OrderLine";
        this.drawType = 'manually';
        this.maxPointCount = 1;
        this.hasSettings = true;
        this.settings = $.extend({drawLabel: true}, layer.chart.env.userSettings.chartSettings.contextSettings);
    };

    inheritPrototype(iChart.Charting.ChartOrderLine, iChart.Charting.ChartElement);

    iChart.Charting.ChartOrderLine.prototype.drawInternal = function (ctx, coords)
    {
        if (coords.length < 1)
        {
            return;
        }

        var point = this.layer.area.getXValue(ctx.canvas.width - 200);
        this.points[0].x = point * 1000;
        coords[0].x = ctx.canvas.width - 200;

        ctx.save();
        ctx.beginPath();
        this.initDrawSettings(ctx, this.settings);
        ctx.moveTo(0, coords[0].y);
        ctx.lineTo(ctx.canvas.width, coords[0].y);
        ctx.stroke();
        ctx.restore();

    };

    iChart.Charting.ChartOrderLine.prototype.drawExtended = function (ctx)
    {
        if(this.settings.drawLabel) {
            var pointCoords = this.getCoordinates(ctx, this.points);

            if (pointCoords.length < 1) {
                return;
            }
            var settings = this.settings;
            var label = this.layer.chart.renderer.formatNumber(this.points[0].y, {
                "decimalPrecision": this.layer.chart.labelPrecision,
                "scale": 0
            });
            this.layer.chart.renderer.drawLable(ctx, settings.strokeStyle, 0, this.layer.area.innerWidth, pointCoords[0].y, label);
        }
    };

    iChart.Charting.ChartOrderLine.prototype.setTestSegments = function ()
    {
        this.testContext.segments = [
            [
                { "x": this.layer.area.innerOffset.left, "y": this.testContext.points[0].y },
                { "x": this.layer.area.innerOffset.left + this.layer.area.innerWidth, "y": this.testContext.points[0].y }
            ]
        ];
    };
})();
