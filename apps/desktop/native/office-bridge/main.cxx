// SPDX-License-Identifier: MPL-2.0
// Artemis-owned UNO bridge. One process owns one live document; stdout is JSONL.
#include <cppuhelper/bootstrap.hxx>
#include <com/sun/star/beans/PropertyValue.hpp>
#include <com/sun/star/bridge/XUnoUrlResolver.hpp>
#include <com/sun/star/container/XEnumerationAccess.hpp>
#include <com/sun/star/container/XEnumeration.hpp>
#include <com/sun/star/drawing/XDrawPagesSupplier.hpp>
#include <com/sun/star/drawing/XDrawPage.hpp>
#include <com/sun/star/frame/XComponentLoader.hpp>
#include <com/sun/star/frame/XStorable.hpp>
#include <com/sun/star/lang/XComponent.hpp>
#include <com/sun/star/sheet/XSpreadsheetDocument.hpp>
#include <com/sun/star/sheet/XSpreadsheet.hpp>
#include <com/sun/star/text/XTextDocument.hpp>
#include <com/sun/star/text/XTextRange.hpp>
#include <com/sun/star/text/XTextCursor.hpp>
#include <com/sun/star/uno/XComponentContext.hpp>
#include <osl/file.hxx>
#include <nlohmann/json.hpp>
#include <chrono>
#include <iostream>
#include <thread>
#include <vector>

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

class Document {
    Reference<css::lang::XComponent> component;
    std::string format;

    std::vector<Reference<css::text::XTextRange>> paragraphs() {
        Reference<css::text::XTextDocument> document(component, UNO_QUERY_THROW);
        Reference<css::container::XEnumerationAccess> access(document->getText(), UNO_QUERY_THROW);
        auto enumeration = access->createEnumeration();
        std::vector<Reference<css::text::XTextRange>> result;
        while (enumeration->hasMoreElements()) {
            Reference<css::text::XTextRange> paragraph(enumeration->nextElement(), UNO_QUERY);
            if (paragraph.is()) result.push_back(paragraph);
            if (result.size() > 20000) throw std::runtime_error("Document exceeds current paragraph selection limit");
        }
        return result;
    }
    Reference<css::sheet::XSpreadsheet> sheet(const std::string& name) {
        Reference<css::sheet::XSpreadsheetDocument> document(component, UNO_QUERY_THROW);
        return Reference<css::sheet::XSpreadsheet>(document->getSheets()->getByName(u(name)), UNO_QUERY_THROW);
    }
public:
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
                    Reference<css::text::XTextRange> text(page->getByIndex(i), UNO_QUERY);
                    if (text.is()) result["targets"].push_back({{"selection", {{"kind", "object"}, {"page", p + 1}, {"index", i}}}, {"text", s(text->getString())}});
                }
            }
        } else {
            Reference<css::sheet::XSpreadsheetDocument> document(component, UNO_QUERY_THROW);
            for (const auto& name : document->getSheets()->getElementNames()) {
                result["sheets"].push_back(s(name));
                auto current = sheet(s(name));
                // The PDF is the full native render. These cells are selection targets only.
                for (int row = 0; row < 50; row++) for (int column = 0; column < 26; column++) {
                    auto cell = current->getCellByPosition(column, row);
                    Reference<css::text::XTextRange> text(cell, UNO_QUERY_THROW);
                    auto value = text->getString();
                    if (!value.isEmpty()) result["targets"].push_back({{"selection", {{"kind", "cells"}, {"sheet", s(name)}, {"range", std::string(1, 'A' + column) + std::to_string(row + 1)}}}, {"text", s(value)}});
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
            Reference<css::drawing::XDrawPagesSupplier> supplier(component, UNO_QUERY_THROW);
            Reference<css::drawing::XDrawPage> page(supplier->getDrawPages()->getByIndex(change.at("page").get<int>() - 1), UNO_QUERY_THROW);
            Reference<css::text::XTextRange> text(page->getByIndex(change.at("object")), UNO_QUERY_THROW);
            text->setString(u(change.at("text")));
        } else if ((type == "set-cells" || type == "set-formula") && format == "excel") {
            auto current = sheet(change.at("sheet"));
            int row = change.at("row").get<int>() - 1, column = change.at("column").get<int>() - 1;
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
    }
    void close() { if (component.is()) { component->dispose(); component.clear(); } }
};

int main(int argc, char** argv) {
    if (argc != 3) { std::cerr << "Usage: office-bridge <bootstrap-file-url> <uno-pipe-url>\n"; return 2; }
    try {
        auto context = cppu::defaultBootstrap_InitialComponentContext(u(argv[1]));
        Reference<css::bridge::XUnoUrlResolver> resolver(context->getServiceManager()->createInstanceWithContext(u("com.sun.star.bridge.UnoUrlResolver"), context), UNO_QUERY_THROW);
        Reference<css::uno::XComponentContext> remote;
        for (int i = 0; i < 150 && !remote.is(); i++) {
            try { remote.set(resolver->resolve(u(argv[2])), UNO_QUERY_THROW); }
            catch (const css::uno::Exception&) { if (i == 149) throw; std::this_thread::sleep_for(std::chrono::milliseconds(100)); }
        }
        Reference<css::frame::XComponentLoader> loader(remote->getServiceManager()->createInstanceWithContext(u("com.sun.star.frame.Desktop"), remote), UNO_QUERY_THROW);
        Document document;
        std::string line;
        while (std::getline(std::cin, line)) {
            json response;
            try {
                if (line.size() > 8 * 1024 * 1024) throw std::runtime_error("Request too large");
                auto input = json::parse(line);
                response["id"] = input.at("id");
                auto command = input.at("command").get<std::string>();
                if (command == "open") document.open(loader, input);
                else if (command == "apply") document.apply(input.at("change"));
                else if (command == "render" || command == "save") document.store(input.at("path"), command == "render");
                else if (command == "close") document.close();
                else if (command != "snapshot") throw std::runtime_error("Unknown command");
                response["result"] = command == "snapshot" || command == "open" ? document.snapshot() : json::object();
            } catch (const css::uno::Exception& error) { response["error"] = s(error.Message); }
            catch (const std::exception& error) { response["error"] = error.what(); }
            std::cout << response.dump() << std::endl;
        }
        document.close();
        return 0;
    } catch (const css::uno::Exception& error) { std::cerr << s(error.Message) << std::endl; }
    catch (const std::exception& error) { std::cerr << error.what() << std::endl; }
    return 1;
}
