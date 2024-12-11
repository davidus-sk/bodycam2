export class Modal {
    options = {};

    constructor(options, app) {
        this.options = this.initializeOptions(options);
        this.app = app;

        // events dispatcher
        //EventDispatcher.attach(this);

        // local variables
        this._$element = null;
        this._$parent = null;

        this._id = null;
        this._initialized = false;
        this._visible = false;
        this._width = 0;
        this._height = 0;

        // id
        this._id = this.options.id ?? this._generateId();

        // parent
        if (typeof this.options.parent === 'string') {
            this._$parent = $(this.options.parent ?? 'body');
        } else if (typeof this.options.parent === 'object') {
            this._$parent = this.options.parent;
        } else {
            this._$parent = $('body');
        }

        // events
        this.onShow = this.options.onShow;
        this.onHide = this.options.onHide;
        this.onDestroy = this.options.onDestroy;
    }

    initializeOptions(userOptions) {
        const defaultOptions = {
            id: undefined,
            width: 400,
            height: 400,
            parent: 'body',
            x: 'CENTER',
            y: 'CENTER',
            offsetX: 0,
            offsetY: 0,
            title: undefined,
            body: undefined,

            // events
            onShow: undefined,
            onHide: undefined,
            onDestroy: undefined,
        };

        return { ...defaultOptions, ...userOptions };
    }

    getId() {
        return this._id;
    }

    setTitle(title) {}

    setBody(body) {}

    show() {
        // initialize new modal window
        if (this._initialized === false) {
            this._initialized = true;

            const html = this._generateHtml();

            $('body').css({ position: 'relative' }).append(html);

            this._$element = $('#' + this._id);

            // dimensions
            this._width = this.options.width;
            this._height = this.options.height;

            // position
            this.setPosition(
                this.options.x,
                this.options.y,
                this.options.offsetX,
                this.options.offsetY
            );
        }

        // already initialized
        this._$element.show();

        // event
        this.onShow?.();

        // return instance
        return this;
    }

    hide() {
        if (this._initialized === true) {
            this._$element.hide();
        }

        // event
        this.onHide?.();

        // return instance
        return this;
    }

    reset() {
        if (this._initialized === true) {
            this._$element.html('');
        }

        // return instance
        return this;
    }

    destroy() {
        if (this._initialized === true) {
            this.hide();
            this._$element.remove();

            this._initialized = false;
            this._$element = undefined;
            this._width = this.options.width;
            this._height = this.options.height;
        }

        // event
        this.onDestroy?.();
    }

    setPosition(x, y, offsetX, offsetY) {
        let _x = x;
        let _y = y;
        let _offsetX = offsetX !== undefined ? offsetX : 0;
        let _offsetY = offsetY !== undefined ? offsetY : 0;

        if (typeof _offsetX !== 'number') {
            _offsetX = 0;
        }
        if (typeof _offsetY !== 'number') {
            _offsetY = 0;
        }

        let css = {
            left: 'auto',
            right: 'auto',
            top: 'auto',
            bottom: 'auto',
        };

        // center of parent element
        let center = this._getCenterCoordinates();

        // X
        if (typeof _x === 'string') {
            _x = _x.toUpperCase();
            if (['LEFT', 'RIGHT', 'CENTER'].indexOf(_x) !== -1) {
                switch (_x) {
                    case 'LEFT':
                        css.left = 0 + _offsetX + 'px';
                        break;
                    case 'RIGHT':
                        css.right = 0 + _offsetX + 'px';
                        break;
                    case 'CENTER':
                        css.left = center.x + _offsetX - this._width / 2 + 'px';
                        break;
                }
            }
        }

        // Y
        if (typeof _y === 'string') {
            _y = _y.toUpperCase();
            if (['TOP', 'BOTTOM', 'CENTER'].indexOf(_y) !== -1) {
                switch (_y) {
                    case 'TOP':
                        css.top = 0 + _offsetY + 'px';
                        break;
                    case 'BOTTOM':
                        css.top = 0 + _offsetY + 'px';
                        break;
                    case 'CENTER':
                        css.top = center.y + _offsetY - this._height / 2 + 'px';
                        break;
                }
            }
        }

        this._$element.css(css);

        // return instance
        return this;
    }

    _generateHtml() {
        const body = this.options.body ?? '';
        const width = this.options.width;
        const height = this.options.height;

        return `
        <div id="${this._id}" class="modal-win" tabindex="-1" style="display: none2; width:${width}px; height:${height}px;">
            <div class="modal-win-dialog">
                <div class="modal-win-header">
                    <button type="button" class="btn-close"></button>
                </div>
                <div class="modal-win-body">
                ${body}
                </div>
            </div>
        </div>
        `;
    }

    _generateId() {
        return 'modal-' + Math.random().toString(36).substring(2, 8);
    }

    _getCenterCoordinates() {
        var offset = this._$parent.offset();
        var width = this._$parent.outerWidth();
        var height = this._$parent.outerHeight();

        var centerX = offset.left + width / 2;
        var centerY = offset.top + height / 2;

        return { x: centerX, y: centerY };
    }
}
