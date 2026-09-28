// SPDX-License-Identifier: MPL-2.0
// Artemis-owned UNO bridge. One process owns one live document; stdout is JSONL.
#include <cppuhelper/bootstrap.hxx>
#include <com/sun/star/beans/PropertyValue.hpp>
#include <com/sun/star/beans/XPropertySet.hpp>
#include <com/sun/star/bridge/XUnoUrlResolver.hpp>
#include <com/sun/star/container/XEnumerationAccess.hpp>
#include <com/sun/star/container/XEnumeration.hpp>
#include <com/sun/star/drawing/XDrawPagesSupplier.hpp>
#include <com/sun/star/drawing/XDrawPage.hpp>
#include <com/sun/star/drawing/XShape.hpp>
#include <com/sun/star/drawing/XShapes.hpp>
#include <com/sun/star/frame/XComponentLoader.hpp>
#include <com/sun/star/frame/XDesktop.hpp>
#include <com/sun/star/frame/XStorable.hpp>
#include <com/sun/star/lang/XComponent.hpp>
#include <com/sun/star/lang/XMultiServiceFactory.hpp>
#include <com/sun/star/sheet/XSpreadsheetDocument.hpp>
#include <com/sun/star/sheet/XSpreadsheet.hpp>
#include <com/sun/star/sheet/XCellRangeData.hpp>
#include <com/sun/star/sheet/XCellRangeFormula.hpp>
#include <com/sun/star/sheet/XDataPilotTablesSupplier.hpp>
#include <com/sun/star/sheet/XDataPilotTable.hpp>
#include <com/sun/star/table/XTable.hpp>
#include <com/sun/star/text/XTextDocument.hpp>
#include <com/sun/star/text/XTextRange.hpp>
#include <com/sun/star/text/XTextCursor.hpp>
#include <com/sun/star/text/XTextTable.hpp>
#include <com/sun/star/text/XTextFramesSupplier.hpp>
#include <com/sun/star/uno/XComponentContext.hpp>
#include <osl/file.hxx>
#include <nlohmann/json.hpp>
#include <chrono>
#include <iostream>
#include <thread>
#include <vector>
#include <algorithm>

namespace css = com::sun::star;
using css::uno::Reference;
using css::uno::UNO_QUERY_THROW;
using css::uno::UNO_QUERY;
using rtl::OUString;
using json = nlohmann::json;

static OUString u(const std::string& value) { return OUString::fromUtf8(rtl::OString(value.data(), static_cast<sal_Int32>(value.size()))); }
static std::string s(const OUString& value) { auto bytes = rtl::OUStringToOString(value, RTL_TEXTENCODING_UTF8); return {bytes.getStr(), static_cast<size_t>(bytes.getLength())}; }
static OUString url(const std::string& path) {
    OUString result;
    if (osl::FileBase::getFileURLFromSystemPath(u(path), result) != osl::FileBase::E_None) throw std::runtime_error("Invalid file path");
    return result;
}
template<typename T> static css::beans::PropertyValue prop(const char* name, const T& value) {
    css::beans::PropertyValue result;
    result.Name = u(name); result.Value <<= value;
    return result;
}
static css::uno::Sequence<css::beans::PropertyValue> props(std::initializer_list<css::beans::PropertyValue> values) {
    return { values.begin(), static_cast<sal_Int32>(values.size()) };
}
static void advance(const Reference<css::text::XTextCursor>& cursor, int count, bool select) {
    if (count < 0) throw std::runtime_error("Invalid text offset");
    while (count) {
        auto step = static_cast<sal_Int16>(std::min(count, 32767));
        if (!cursor->goRight(step, select)) throw std::runtime_error("Text offset exceeds paragraph");
        count -= step;
    }
}

#include "smartart.hxx"

class Document {
    Reference<css::lang::XComponent> component;
    std::string format;
    SmartArtText smartArt;

    void collectParagraphs(const Reference<css::text::XText>& text, std::vector<Reference<css::text::XTextRange>>& result, int depth = 0) {
        if (depth > 16) throw std::runtime_error("Document exceeds table nesting limit");
        Reference<css::container::XEnumerationAccess> access(text, UNO_QUERY_THROW);
        auto enumeration = access->createEnumeration();
        while (enumeration->hasMoreElements()) {
            auto item = enumeration->nextElement();
            Reference<css::text::XTextTable> table(item, UNO_QUERY);
            if (table.is()) {
                for (const auto& name : table->getCellNames())
                    collectParagraphs(Reference<css::text::XText>(table->getCellByName(name), UNO_QUERY_THROW), result, depth + 1);
            } else {
                Reference<css::text::XTextRange> paragraph(item, UNO_QUERY);
                if (paragraph.is()) result.push_back(paragraph);
            }
            if (result.size() > 20000) throw std::runtime_error("Document exceeds current paragraph selection limit");
        }
    }
    std::vector<Reference<css::text::XTextRange>> paragraphs() {
        Reference<css::text::XTextDocument> document(component, UNO_QUERY_THROW);
        std::vector<Reference<css::text::XTextRange>> result;
        collectParagraphs(document->getText(), result);
        Reference<css::text::XTextFramesSupplier> frames(component, UNO_QUERY);
        if (frames.is()) for (const auto& name : frames->getTextFrames()->getElementNames())
            collectParagraphs(Reference<css::text::XText>(frames->getTextFrames()->getByName(name), UNO_QUERY_THROW), result);
        return result;
    }
    Reference<css::sheet::XSpreadsheet> sheet(const std::string& name) {
        Reference<css::sheet::XSpreadsheetDocument> document(component, UNO_QUERY_THROW);
        return Reference<css::sheet::XSpreadsheet>(document->getSheets()->getByName(u(name)), UNO_QUERY_THROW);
    }
    std::vector<css::table::CellRangeAddress> pivots(const Reference<css::sheet::XSpreadsheet>& current) {
        Reference<css::sheet::XDataPilotTablesSupplier> supplier(current, UNO_QUERY_THROW);
        auto tables = supplier->getDataPilotTables();
        std::vector<css::table::CellRangeAddress> result;
        for (const auto& name : tables->getElementNames())
            result.push_back(Reference<css::sheet::XDataPilotTable>(tables->getByName(name), UNO_QUERY_THROW)->getOutputRange());
        return result;
    }
    static bool overlaps(const css::table::CellRangeAddress& range, int row, int column, int rows = 1, int columns = 1) {
        return row <= range.EndRow && row + rows - 1 >= range.StartRow && column <= range.EndColumn && column + columns - 1 >= range.StartColumn;
    }
    Reference<css::drawing::XShape> shape(const json& change) {
        Reference<css::drawing::XDrawPagesSupplier> supplier(component, UNO_QUERY_THROW);
        Reference<css::drawing::XShapes> page(supplier->getDrawPages()->getByIndex(change.at("page").get<int>() - 1), UNO_QUERY_THROW);
        Reference<css::drawing::XShape> result(page->getByIndex(change.at("object")), UNO_QUERY_THROW);
        if (change.contains("path")) for (const auto& index : change.at("path"))
            result.set(Reference<css::drawing::XShapes>(result, UNO_QUERY_THROW)->getByIndex(index), UNO_QUERY_THROW);
        return result;
    }
    Reference<css::table::XTable> shapeTable(const Reference<css::drawing::XShape>& value) {
        Reference<css::beans::XPropertySet> properties(value, UNO_QUERY_THROW);
        if (!properties->getPropertySetInfo()->hasPropertyByName(u("Model"))) return {};
        return Reference<css::table::XTable>(properties->getPropertyValue(u("Model")), UNO_QUERY);
    }
    void collectShapes(const Reference<css::drawing::XShape>& value, const json& selection, json& targets) {
        if (targets.size() >= 20000) throw std::runtime_error("Document exceeds object selection limit");
        auto position = value->getPosition(); auto size = value->getSize();
        Reference<css::text::XTextRange> text(value, UNO_QUERY);
        targets.push_back({{"selection", selection}, {"text", text.is() ? s(text->getString()) : ""}, {"editable", text.is()}, {"bounds", {{"x", position.X}, {"y", position.Y}, {"width", size.Width}, {"height", size.Height}}}});
        auto table = shapeTable(value);
        if (table.is()) {
            if (table->getRows()->getCount() > 1000 || table->getColumns()->getCount() > 256) throw std::runtime_error("Shape table exceeds selection limit");
            for (int row = 0; row < table->getRows()->getCount(); row++) for (int column = 0; column < table->getColumns()->getCount(); column++) {
                auto cellSelection = selection;
                cellSelection["cell"] = {{"row", row}, {"column", column}};
                Reference<css::text::XTextRange> cell(table->getCellByPosition(column, row), UNO_QUERY_THROW);
                targets.push_back({{"selection", cellSelection}, {"text", s(cell->getString())}, {"editable", true}});
                if (targets.size() > 20000) throw std::runtime_error("Document exceeds object selection limit");
            }
        }
        Reference<css::drawing::XShapes> children(value, UNO_QUERY);
        if (children.is()) for (int i = 0; i < children->getCount(); i++) {
            auto nested = selection;
            if (!nested.contains("path")) nested["path"] = json::array();
            if (nested["path"].size() >= 16) throw std::runtime_error("Shape exceeds nesting limit");
            nested["path"].push_back(i);
            collectShapes(Reference<css::drawing::XShape>(children->getByIndex(i), UNO_QUERY_THROW), nested, targets);
        }
    }
public:
    explicit Document(const Reference<css::uno::XComponentContext>& context) : smartArt(context) {}
    void open(const Reference<css::frame::XComponentLoader>& loader, const json& input) {
        if (component.is()) throw std::runtime_error("Document already open");
        format = input.at("format").get<std::string>();
        if (format != "word" && format != "powerpoint" && format != "excel") throw std::runtime_error("Unsupported format");
        auto options = props({
            prop("Hidden", true), prop("ReadOnly", false), prop("Silent", true),
            prop("MacroExecutionMode", sal_Int16(0)), prop("UpdateDocMode", sal_Int16(0))
        });
        component = loader->loadComponentFromURL(url(input.at("path")), u("_blank"), 0, options);
        if (!component.is()) throw std::runtime_error("LibreOffice could not load this document");
        smartArt.open(input.at("path"));
    }
    json snapshot() {
        if (!component.is()) throw std::runtime_error("No live document");
        json result = {{"targets", json::array()}, {"sheets", json::array()}, {"warnings", json::array()}};
        if (format == "word") {
            auto values = paragraphs();
            for (size_t i = 0; i < values.size(); ++i) {
                auto text = values[i]->getString();
                result["targets"].push_back({{"selection", {{"kind", "paragraph"}, {"index", i}, {"start", 0}, {"end", text.getLength()}}}, {"text", s(text)}});
            }
        } else if (format == "powerpoint") {
            Reference<css::drawing::XDrawPagesSupplier> supplier(component, UNO_QUERY_THROW);
            auto pages = supplier->getDrawPages();
            for (sal_Int32 p = 0; p < pages->getCount(); ++p) {
                Reference<css::drawing::XDrawPage> page(pages->getByIndex(p), UNO_QUERY_THROW);
                for (sal_Int32 i = 0; i < page->getCount(); ++i) {
                    collectShapes(Reference<css::drawing::XShape>(page->getByIndex(i), UNO_QUERY_THROW), {{"kind", "object"}, {"page", p + 1}, {"index", i}}, result["targets"]);
                }
            }
        } else {
            Reference<css::sheet::XSpreadsheetDocument> document(component, UNO_QUERY_THROW);
            for (const auto& name : document->getSheets()->getElementNames()) {
                result["sheets"].push_back(s(name));
                auto current = sheet(s(name));
                // The PDF is the full native render. These cells are selection targets only.
                // Two bulk UNO calls replace thousands of cross-process cell/property calls.
                auto range = current->getCellRangeByPosition(0, 0, 25, 49);
                auto values = Reference<css::sheet::XCellRangeData>(range, UNO_QUERY_THROW)->getDataArray();
                auto formulas = Reference<css::sheet::XCellRangeFormula>(range, UNO_QUERY_THROW)->getFormulaArray();
                auto outputs = pivots(current);
                for (int row = 0; row < values.getLength(); row++) for (int column = 0; column < values[row].getLength(); column++) {
                    OUString text; double number;
                    if (values[row][column] >>= text) { if (text.isEmpty() && formulas[row][column].isEmpty()) continue; }
                    else if (values[row][column] >>= number) text = OUString::number(number);
                    else continue;
                    auto target = json{{"selection", {{"kind", "cells"}, {"sheet", s(name)}, {"range", std::string(1, 'A' + column) + std::to_string(row + 1)}}}, {"text", s(text)}, {"editable", std::none_of(outputs.begin(), outputs.end(), [&](const auto& output) { return overlaps(output, row, column); })}};
                    if (formulas[row][column].startsWith(u("="))) target["formula"] = s(formulas[row][column]);
                    result["targets"].push_back(target);
                    if (result["targets"].size() > 20000) throw std::runtime_error("Document exceeds cell selection limit");
                }
            }
            result["warnings"].push_back("Cell selection index covers A1:Z50 per sheet; the native PDF includes the document's configured print areas.");
        }
        return result;
    }
    void apply(const json& change) {
        auto type = change.at("type").get<std::string>();
        if (type == "replace-text" && format == "word") {
            auto values = paragraphs();
            auto index = change.at("paragraph").get<size_t>();
            if (index >= values.size()) throw std::runtime_error("Paragraph not found");
            auto paragraph = values[index];
            int start = change.at("start"), end = change.at("end");
            if (end < start || end > paragraph->getString().getLength()) throw std::runtime_error("Invalid paragraph selection");
            auto cursor = paragraph->getText()->createTextCursorByRange(paragraph->getStart());
            advance(cursor, start, false); advance(cursor, end - start, true);
            cursor->setString(u(change.at("text")));
        } else if (type == "set-object-text" && format == "powerpoint") {
            auto value = shape(change);
            Reference<css::text::XTextRange> text(value, UNO_QUERY);
            if (change.contains("cell")) {
                auto table = shapeTable(value);
                if (!table.is()) throw std::runtime_error("Object is not a table");
                text.set(table->getCellByPosition(change["cell"]["column"], change["cell"]["row"]), UNO_QUERY_THROW);
            }
            if (!text.is()) throw std::runtime_error("Object has no editable text");
            if (change.contains("path") && !change.at("path").empty()) {
                auto root = change; root.erase("path");
                Reference<css::container::XNamed> named(shape(root), UNO_QUERY_THROW);
                smartArt.prepare(named->getName(), s(text->getString()), change.at("text"));
            }
            auto cursor = text->getText()->createTextCursor();
            cursor->gotoStart(false); cursor->gotoEnd(true);
            cursor->setString(u(change.at("text")));
        } else if (type == "move-object" && format == "powerpoint") {
            shape(change)->setPosition(css::awt::Point(change.at("x"), change.at("y")));
        } else if (type == "insert-slide-text" && format == "powerpoint") {
            Reference<css::drawing::XDrawPagesSupplier> supplier(component, UNO_QUERY_THROW);
            Reference<css::drawing::XShapes> page(supplier->getDrawPages()->getByIndex(change.at("page").get<int>() - 1), UNO_QUERY_THROW);
            if (page->getCount() != change.at("object").get<int>()) throw std::runtime_error("Slide object list changed; read a fresh snapshot");
            Reference<css::lang::XMultiServiceFactory> factory(component, UNO_QUERY_THROW);
            Reference<css::drawing::XShape> value(factory->createInstance(u("com.sun.star.drawing.TextShape")), UNO_QUERY_THROW);
            page->add(value);
            value->setPosition(css::awt::Point(change.at("x"), change.at("y")));
            value->setSize(css::awt::Size(change.at("width"), change.at("height")));
            Reference<css::text::XTextRange>(value, UNO_QUERY_THROW)->setString(u(change.at("text")));
        } else if ((type == "set-cells" || type == "set-formula") && format == "excel") {
            auto current = sheet(change.at("sheet"));
            int row = change.at("row").get<int>() - 1, column = change.at("column").get<int>() - 1;
            for (const auto& output : pivots(current))
                if (overlaps(output, row, column, type == "set-cells" ? change.at("values").size() : 1, type == "set-cells" ? change.at("values")[0].size() : 1))
                    throw std::runtime_error("Pivot result cells are derived; edit the pivot source data instead");
            if (type == "set-formula") {
                current->getCellByPosition(column, row)->setFormula(u(change.at("formula")));
            } else {
                const auto& rows = change.at("values");
                for (size_t r = 0; r < rows.size(); ++r) for (size_t c = 0; c < rows[r].size(); ++c) {
                    auto cell = current->getCellByPosition(column + c, row + r);
                    auto value = rows[r][c];
                    if (value.is_number()) cell->setValue(value.get<double>());
                    else if (value.is_boolean()) cell->setValue(value.get<bool>() ? 1 : 0);
                    else { Reference<css::text::XTextRange> text(cell, UNO_QUERY_THROW); text->setString(value.is_null() ? OUString() : u(value.get<std::string>())); }
                }
            }
        } else throw std::runtime_error("Operation does not match document format");
    }
    void store(const std::string& path, bool pdf) {
        Reference<css::frame::XStorable> storable(component, UNO_QUERY_THROW);
        const char* filter = pdf ? (format == "word" ? "writer_pdf_Export" : format == "excel" ? "calc_pdf_Export" : "impress_pdf_Export") : (format == "word" ? "Office Open XML Text" : format == "excel" ? "Calc MS Excel 2007 XML" : "Impress MS PowerPoint 2007 XML");
        storable->storeToURL(url(path), props({ prop("FilterName", u(filter)), prop("Overwrite", true) }));
        if (!pdf && format == "powerpoint") smartArt.save(path);
    }
    void close() { if (component.is()) { component->dispose(); component.clear(); } }
};

int main(int argc, char** argv) {
    if (argc != 3) { std::cerr << "Usage: office-bridge <bootstrap-file-url> <uno-pipe-url>\n"; return 2; }
    try {
        auto context = cppu::defaultBootstrap_InitialComponentContext(u(argv[1]));
        Reference<css::bridge::XUnoUrlResolver> resolver(context->getServiceManager()->createInstanceWithContext(u("com.sun.star.bridge.UnoUrlResolver"), context), UNO_QUERY_THROW);
        Reference<css::uno::XComponentContext> remote;
        const auto startupDeadline = std::chrono::steady_clock::now() + std::chrono::seconds(60);
        while (!remote.is()) {
            try { remote.set(resolver->resolve(u(argv[2])), UNO_QUERY_THROW); }
            catch (const css::uno::Exception&) { if (std::chrono::steady_clock::now() >= startupDeadline) throw; std::this_thread::sleep_for(std::chrono::milliseconds(100)); }
        }
        Reference<css::frame::XComponentLoader> loader(remote->getServiceManager()->createInstanceWithContext(u("com.sun.star.frame.Desktop"), remote), UNO_QUERY_THROW);
        Document document(remote);
        std::string line;
        while (std::getline(std::cin, line)) {
            json response;
            bool shutdown = false;
            try {
                if (line.size() > 8 * 1024 * 1024) throw std::runtime_error("Request too large");
                auto input = json::parse(line);
                response["id"] = input.at("id");
                auto command = input.at("command").get<std::string>();
                if (command == "open") document.open(loader, input);
                else if (command == "apply") document.apply(input.at("change"));
                else if (command == "render" || command == "save") document.store(input.at("path"), command == "render");
                else if (command == "close") document.close();
                else if (command == "shutdown") {
                    document.close();
                    shutdown = true;
                    if (!Reference<css::frame::XDesktop>(loader, UNO_QUERY_THROW)->terminate()) throw std::runtime_error("Office runtime refused shutdown");
                }
                else if (command != "snapshot") throw std::runtime_error("Unknown command");
                response["result"] = command == "snapshot" || command == "open" ? document.snapshot() : json::object();
            } catch (const css::uno::Exception& error) { response["error"] = s(error.Message); }
            catch (const std::exception& error) { response["error"] = error.what(); }
            std::cout << response.dump() << std::endl;
            if (shutdown) break;
        }
        document.close();
        return 0;
    } catch (const css::uno::Exception& error) { std::cerr << s(error.Message) << std::endl; }
    catch (const std::exception& error) { std::cerr << error.what() << std::endl; }
    return 1;
}
